import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowGraphModel } from '../../renderer/src/features/workflow/buildWorkflowGraph.js';
import type { WorkflowProcessItemT, WorkflowRunT } from '@kodax-space/space-ipc-schema';

function item(over: Partial<WorkflowProcessItemT> & { id: string }): WorkflowProcessItemT {
  return { title: over.id, kind: 'step', status: 'pending', ...over };
}

function run(over: Partial<WorkflowRunT>): WorkflowRunT {
  return {
    runId: 'wf-test',
    workflowName: 'review',
    status: 'running',
    startedAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:01.000Z',
    items: [],
    counts: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
    progress: {
      spawnedAgents: 0,
      finishedAgents: 0,
      activeAgents: 0,
      failedAgents: 0,
      stoppedAgents: 0,
    },
    ...over,
  };
}

test('workflow graph keeps phase order and branch counts', () => {
  const model = buildWorkflowGraphModel(
    run({
      patterns: ['fan-out-and-synthesize'],
      phaseCount: 2,
      items: [
        item({ id: 'p1', title: 'Collect', kind: 'phase', status: 'completed' }),
        item({ id: 'a1', title: 'history', kind: 'agent', phaseId: 'p1', status: 'completed' }),
        item({ id: 's1', title: 'git log', parentId: 'a1', status: 'completed' }),
        item({ id: 'p2', title: 'Review', kind: 'phase', status: 'running' }),
        item({ id: 'a2', title: 'risk', kind: 'agent', phaseId: 'p2', status: 'running' }),
      ],
    }),
  );

  assert.equal(model.phases.length, 2);
  assert.equal(model.patterns[0]?.id, 'fan-out-and-synthesize');
  assert.equal(model.patterns[0]?.tone, 'parallel');
  assert.deepEqual(
    model.phases.map((phase) => phase.title),
    ['Collect', 'Review'],
  );
  assert.equal(model.phases[0]?.counts.completed, 2);
  assert.equal(model.phases[0]?.nodes[0]?.descendantCount, 1);
  assert.equal(model.phases[1]?.activeLabel, 'risk');
});

test('workflow graph reads pattern metadata from host metadata fallback', () => {
  const model = buildWorkflowGraphModel(
    run({
      hostMetadata: { workflowPatterns: '["classify-and-act","loop-until-done"]' },
      items: [item({ id: 'p1', title: 'Route', kind: 'phase', status: 'running' })],
    }),
  );

  assert.deepEqual(
    model.patterns.map((pattern) => pattern.id),
    ['classify-and-act', 'loop-until-done'],
  );
  assert.deepEqual(
    model.patterns.map((pattern) => pattern.tone),
    ['route', 'loop'],
  );
});

test('workflow graph exposes failed child as phase active label', () => {
  const model = buildWorkflowGraphModel(
    run({
      status: 'failed',
      items: [
        item({ id: 'p1', title: 'Review', kind: 'phase', status: 'failed' }),
        item({ id: 'a1', title: 'quality', kind: 'agent', phaseId: 'p1', status: 'failed' }),
        item({ id: 'a2', title: 'security', kind: 'agent', phaseId: 'p1', status: 'cancelled' }),
      ],
    }),
  );

  assert.equal(model.phases[0]?.status, 'failed');
  assert.equal(model.phases[0]?.counts.failed, 1);
  assert.equal(model.phases[0]?.counts.cancelled, 1);
  assert.equal(model.phases[0]?.activeLabel, 'quality');
});

test('workflow graph folds orphan agent roots back into matching phase', () => {
  const model = buildWorkflowGraphModel(
    run({
      phaseCount: 4,
      progress: {
        spawnedAgents: 1,
        finishedAgents: 0,
        activeAgents: 1,
        failedAgents: 0,
        stoppedAgents: 0,
        plannedItems: 4,
      },
      items: [
        item({ id: 'phase-1', title: 'Collect changes', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-2', title: 'Review', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-3', title: 'Synthesize', kind: 'phase', status: 'pending' }),
        item({ id: 'agent-1', title: 'Collect changes', kind: 'agent', status: 'running' }),
      ],
    }),
  );

  assert.equal(model.phases.length, 3);
  assert.deepEqual(
    model.phases.map((phase) => `${phase.index}/${phase.total}`),
    ['1/3', '2/3', '3/3'],
  );
  assert.equal(model.phases[0]?.status, 'running');
  assert.equal(model.phases[0]?.nodes[0]?.title, 'Collect changes');
  assert.equal(model.phases[0]?.activeLabel, 'Collect changes');
  assert.equal(model.phases[2]?.status, 'pending');
});

test('workflow graph assigns loose agents to their closest phase (no bucket)', () => {
  const model = buildWorkflowGraphModel(
    run({
      phaseCount: 3,
      items: [
        item({ id: 'phase-1', title: 'Collect changes', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-2', title: 'Review everything', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-3', title: 'Synthesize', kind: 'phase', status: 'pending' }),
        item({ id: 'agent-1', title: 'Collect changes', kind: 'agent', status: 'completed' }),
        item({ id: 'agent-2', title: 'Quality review', kind: 'agent', status: 'running' }),
        item({ id: 'agent-3', title: 'Security review', kind: 'agent', status: 'running' }),
      ],
    }),
  );

  // agent-1 exact-matches phase 1; the two reviewers share the "review" token with phase 2,
  // so they land there. No trailing bucket — every agent has a home.
  assert.equal(model.phases.length, 3);
  assert.equal(model.phases[0]?.nodes[0]?.title, 'Collect changes');
  assert.deepEqual(
    model.phases[1]?.nodes.map((node) => node.title),
    ['Quality review', 'Security review'],
  );
  assert.deepEqual(model.phases[2]?.nodes.map((node) => node.title), []);
});

test('workflow graph places untagged agents identically as the run progresses (#regression)', () => {
  // Original bug: untagged agents (no phaseId, titles matching no phase) were dumped into
  // the active/last phase, so the group shifted — and a finisher lit up the last phase — as
  // the run advanced. Placement is now name-derived, so the exact same items produce the
  // exact same grouping whatever each agent's status or the active phase is.
  const base = [
    item({ id: 'find', title: 'find', kind: 'phase' }),
    item({ id: 'verify', title: 'verify', kind: 'phase' }),
    item({ id: 'synthesize', title: 'synthesize', kind: 'phase' }),
    item({ id: 'security-ipc', title: 'security-ipc', kind: 'agent' }),
    item({ id: 'workflow-control', title: 'workflow-control', kind: 'agent' }),
    item({ id: 'partner-design', title: 'partner-design', kind: 'agent' }),
    item({ id: 'frontend-ux', title: 'frontend-ux', kind: 'agent' }),
  ];
  const grouping = (agentStatus: WorkflowProcessItemT['status'], over: Partial<WorkflowRunT>) => {
    const items = base.map((it) =>
      it.kind === 'agent'
        ? { ...it, status: agentStatus }
        : { ...it, status: 'pending' as const },
    );
    const model = buildWorkflowGraphModel(run({ phaseCount: 3, items, ...over }));
    return model.phases.map(
      (phase) => `${phase.title}:[${[...phase.nodes.map((n) => n.title)].sort().join(',')}]`,
    );
  };

  const early = grouping('running', {});
  const later = grouping('completed', { status: 'completed', activePhaseId: 'synthesize' });
  // Identical grouping — no shift, no last-phase flare-up from an early finisher.
  assert.deepEqual(early, later);
});

test('workflow graph avoids synthetic workflow-name phase when real phases exist', () => {
  const model = buildWorkflowGraphModel(
    run({
      displayName: 'Version review workflow',
      phaseCount: 3,
      items: [
        item({ id: 'phase-1', title: 'Collect changes', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-2', title: 'Review everything', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-3', title: 'Synthesize', kind: 'phase', status: 'pending' }),
        // Token-superset of phase 1 ("collect changes" ⊆ "collect changes now") → folds in.
        item({ id: 'agent-1', title: 'Collect changes now', kind: 'agent', status: 'running' }),
      ],
    }),
  );

  assert.equal(model.phases.length, 3);
  assert.deepEqual(
    model.phases.map((phase) => phase.title),
    ['Collect changes', 'Review everything', 'Synthesize'],
  );
  assert.equal(model.phases[0]?.status, 'running');
  assert.equal(model.phases[0]?.nodes[0]?.title, 'Collect changes now');
});

test('workflow graph fuzzy-matches generated domain agents and places the orphan closest', () => {
  // The real reported run: manifest declares 7 domain phases, the generated script never
  // opens a phase, and agent names only partially coincide with phase titles.
  const phaseTitles = [
    'license-repointel',
    'workflow',
    'partner',
    'session-config',
    'artifact-ui',
    'e2e-tests',
    'synthesis',
  ];
  const agentTitles = [
    'license-repointel',
    'workflow-system',
    'partner-surface',
    'session-config',
    'artifact-ui',
    'tests-e2e',
    'provider-i18n-misc',
    'synthesize',
  ];
  const model = buildWorkflowGraphModel(
    run({
      phaseCount: phaseTitles.length,
      items: [
        ...phaseTitles.map((title, i) =>
          item({ id: `phase-${i + 1}`, title, kind: 'phase', status: 'pending' }),
        ),
        ...agentTitles.map((title, i) =>
          item({ id: `agent-${i + 1}`, title, kind: 'agent', status: 'completed' }),
        ),
      ],
    }),
  );

  const nodesUnder = (phaseTitle: string) =>
    model.phases.find((phase) => phase.title === phaseTitle)?.nodes.map((node) => node.title) ?? [];

  assert.deepEqual(nodesUnder('license-repointel'), ['license-repointel']); // exact
  assert.deepEqual(nodesUnder('workflow'), ['workflow-system']); // token containment
  assert.deepEqual(nodesUnder('partner'), ['partner-surface']); // token containment
  assert.deepEqual(nodesUnder('artifact-ui'), ['artifact-ui']); // exact
  assert.deepEqual(nodesUnder('e2e-tests'), ['tests-e2e']); // reordered tokens
  assert.deepEqual(nodesUnder('synthesis'), ['synthesize']); // single-token stem
  // No declared phase matches the orphan, so it goes to its most character-similar phase
  // (session-config) rather than a separate bucket. Mildly wrong but stable — the accepted
  // trade. No synthetic "parallel" phase is created, and every agent is placed exactly once.
  assert.deepEqual(nodesUnder('session-config'), ['session-config', 'provider-i18n-misc']);
  assert.equal(model.phases.length, 7);
  const placed = model.phases.flatMap((phase) => phase.nodes.map((node) => node.title));
  assert.equal(placed.length, 8);
});

test('workflow graph grouping is stable regardless of run progress or active phase', () => {
  const base = [
    item({ id: 'phase-1', title: 'workflow', kind: 'phase' }),
    item({ id: 'phase-2', title: 'partner', kind: 'phase' }),
    item({ id: 'agent-1', title: 'workflow-system', kind: 'agent' }),
    item({ id: 'agent-2', title: 'partner-surface', kind: 'agent' }),
  ];
  const grouping = (over: Partial<WorkflowRunT>, status: WorkflowProcessItemT['status']) => {
    const model = buildWorkflowGraphModel(
      run({ phaseCount: 2, items: base.map((it) => ({ ...it, status })), ...over }),
    );
    return model.phases.map((phase) => `${phase.title}:[${phase.nodes.map((n) => n.title).join(',')}]`);
  };

  const early = grouping({}, 'running');
  const mid = grouping({ activePhaseId: 'phase-1', activePhaseIndex: 0 }, 'running');
  const late = grouping({ status: 'completed', activePhaseId: 'phase-2' }, 'completed');

  // Name-derived mapping never shifts as the run advances — no frontier jump.
  const expected = ['workflow:[workflow-system]', 'partner:[partner-surface]'];
  assert.deepEqual(early, expected);
  assert.deepEqual(mid, expected);
  assert.deepEqual(late, expected);
});

test('workflow graph resolves a near-ambiguous agent deterministically to one phase', () => {
  const model = buildWorkflowGraphModel(
    run({
      phaseCount: 2,
      items: [
        item({ id: 'phase-1', title: 'session-config', kind: 'phase', status: 'pending' }),
        item({ id: 'phase-2', title: 'session-store', kind: 'phase', status: 'pending' }),
        item({ id: 'agent-1', title: 'session', kind: 'agent', status: 'running' }),
      ],
    }),
  );

  // `session` is a subset of BOTH phases; the character-similarity term breaks the near-tie
  // toward the shorter `session-store`. Arbitrary but deterministic (hence stable) — and it
  // gets a home rather than sitting unassigned.
  assert.equal(model.phases.length, 2);
  assert.deepEqual(model.phases[0]?.nodes.map((node) => node.title), []);
  assert.deepEqual(model.phases[1]?.nodes.map((node) => node.title), ['session']);
});

test('workflow graph creates a synthetic run phase when SDK sends no phase items', () => {
  const model = buildWorkflowGraphModel(
    run({
      displayName: 'generated review',
      items: [
        item({ id: 'a1', title: 'reviewer', kind: 'agent', status: 'running' }),
        item({ id: 's1', title: 'scan', parentId: 'a1', status: 'pending' }),
      ],
    }),
  );

  assert.equal(model.phases.length, 1);
  assert.equal(model.phases[0]?.title, 'generated review');
  assert.equal(model.phases[0]?.status, 'running');
  assert.equal(model.phases[0]?.nodes[0]?.title, 'reviewer');
  assert.equal(model.phases[0]?.activeLabel, 'reviewer');
});

test('workflow graph clears stale running states when the run is completed', () => {
  const model = buildWorkflowGraphModel(
    run({
      status: 'completed',
      items: [
        item({ id: 'p1', title: 'Collect', kind: 'phase', status: 'completed' }),
        item({ id: 'p2', title: 'Review', kind: 'phase', status: 'running' }),
        item({ id: 'a1', title: 'stale worker', kind: 'agent', phaseId: 'p2', status: 'running' }),
      ],
    }),
  );

  assert.equal(model.phases[1]?.status, 'completed');
  assert.equal(model.phases[1]?.nodes[0]?.status, 'completed');
  assert.equal(model.phases[1]?.counts.running, 0);
  assert.equal(model.phases[1]?.activeLabel, undefined);
});

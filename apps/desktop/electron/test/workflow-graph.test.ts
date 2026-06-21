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

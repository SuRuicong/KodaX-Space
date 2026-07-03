import type {
  WorkflowProcessItemStatusT,
  WorkflowProcessItemT,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';
import { buildItemTree, type WorkflowTreeNode } from './buildItemTree.js';

export type WorkflowGraphStatus = WorkflowProcessItemStatusT | 'paused';

export interface WorkflowGraphNode {
  readonly id: string;
  readonly title: string;
  readonly kind: WorkflowProcessItemT['kind'];
  readonly status: WorkflowGraphStatus;
  readonly children: readonly WorkflowGraphNode[];
  readonly descendantCount: number;
}

export interface WorkflowGraphPhase {
  readonly id: string;
  readonly title: string;
  readonly status: WorkflowGraphStatus;
  readonly index: number;
  readonly total: number;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly counts: WorkflowGraphCounts;
  readonly activeLabel?: string;
}

export interface WorkflowGraphCounts {
  readonly total: number;
  readonly completed: number;
  readonly running: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface WorkflowGraphModel {
  readonly phases: readonly WorkflowGraphPhase[];
  readonly patterns: readonly WorkflowGraphPattern[];
}

export type WorkflowPatternTone = 'route' | 'parallel' | 'verify' | 'filter' | 'contest' | 'loop';

export interface WorkflowGraphPattern {
  readonly id: string;
  readonly label: string;
  readonly tone: WorkflowPatternTone;
  readonly description: string;
}

export function buildWorkflowGraphModel(run: WorkflowRunT): WorkflowGraphModel {
  const roots = buildItemTree(run.items);
  const phaseRoots = roots.filter((node) => node.item.kind === 'phase');
  const looseRoots = attachLooseRootsToPhases(
    phaseRoots,
    roots.filter((node) => node.item.kind !== 'phase'),
    run,
  );
  const renderedPhaseCount = phaseRoots.length + (looseRoots.length > 0 ? 1 : 0);
  const total =
    phaseRoots.length > 0 ? renderedPhaseCount : Math.max(run.phaseCount ?? 0, renderedPhaseCount);

  const phases: WorkflowGraphPhase[] = phaseRoots.map((node, index) =>
    phaseFromTreeNode(node, index + 1, total || phaseRoots.length, run.status),
  );

  if (looseRoots.length > 0 || phases.length === 0) {
    phases.push(syntheticRunPhase(run, looseRoots, phases.length + 1, Math.max(total, 1)));
  }

  return { phases, patterns: workflowPatternsForRun(run) };
}

const PATTERN_DEFS: Record<string, WorkflowGraphPattern> = {
  'classify-and-act': {
    id: 'classify-and-act',
    label: 'classify',
    tone: 'route',
    description: 'Classifier routes work to the right behavior.',
  },
  'fan-out-and-synthesize': {
    id: 'fan-out-and-synthesize',
    label: 'fan-out',
    tone: 'parallel',
    description: 'Parallel workers converge at a synthesis barrier.',
  },
  'adversarial-verification': {
    id: 'adversarial-verification',
    label: 'verify',
    tone: 'verify',
    description: 'Independent verifier attacks candidate output.',
  },
  'generate-and-filter': {
    id: 'generate-and-filter',
    label: 'filter',
    tone: 'filter',
    description: 'Generators create candidates, then a filter ranks them.',
  },
  tournament: {
    id: 'tournament',
    label: 'tournament',
    tone: 'contest',
    description: 'Competing approaches are judged to pick a winner.',
  },
  'loop-until-done': {
    id: 'loop-until-done',
    label: 'loop',
    tone: 'loop',
    description: 'Rounds repeat until a stop condition is reached.',
  },
};

export function workflowPatternsForRun(run: WorkflowRunT): readonly WorkflowGraphPattern[] {
  const rawPatterns = Array.isArray(run.patterns)
    ? run.patterns
    : parseHostMetadataPatterns(run.hostMetadata);
  const patterns: WorkflowGraphPattern[] = [];
  for (const raw of rawPatterns ?? []) {
    const id = raw.trim();
    if (!id || patterns.some((pattern) => pattern.id === id)) continue;
    patterns.push(
      PATTERN_DEFS[id] ?? {
        id,
        label: id,
        tone: 'parallel',
        description: 'Custom workflow pattern.',
      },
    );
  }
  return patterns;
}

function parseHostMetadataPatterns(
  hostMetadata: WorkflowRunT['hostMetadata'],
): string[] | undefined {
  const raw = hostMetadata?.workflowPatterns ?? hostMetadata?.patterns;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Fallback for comma-separated debug metadata.
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function phaseFromTreeNode(
  node: WorkflowTreeNode,
  index: number,
  total: number,
  runStatus: WorkflowRunT['status'],
): WorkflowGraphPhase {
  const nodes = node.children.map((child) => graphNodeFromTreeNode(child, runStatus));
  const counts = countNodes(nodes);
  return {
    id: node.item.id,
    title: node.item.title || node.item.id,
    status: normalizeTerminalGraphStatus(runStatus, derivePhaseStatus(node.item.status, counts)),
    index,
    total,
    nodes,
    counts,
    activeLabel: findActiveLabel(nodes),
  };
}

function attachLooseRootsToPhases(
  phaseRoots: readonly WorkflowTreeNode[],
  looseRoots: readonly WorkflowTreeNode[],
  run: WorkflowRunT,
): WorkflowTreeNode[] {
  const unassigned: WorkflowTreeNode[] = [];
  for (const node of looseRoots) {
    const phase = findMatchingPhase(phaseRoots, node);
    if (phase) phase.children.push(node);
    else unassigned.push(node);
  }
  if (phaseRoots.length === 0) return unassigned;

  // Compute the frontier phase ONCE — from phase state AFTER explicit (phaseId/title)
  // matches but BEFORE any fallback attachment. Otherwise attaching one untagged agent
  // shifts a phase's *derived* status and pushes the next agent to a different phase — the
  // bug where every finished sub-agent cascaded into the LAST phase. All untagged agents
  // (running OR already-completed) belong to the same active frontier; only an untagged
  // failure prefers an already-failed phase.
  const frontier = findFrontierPhase(phaseRoots, run);
  const failedPhase = phaseRoots.find((phase) => phaseStatusFromNode(phase) === 'failed');

  const stillUnassigned: WorkflowTreeNode[] = [];
  for (const node of unassigned) {
    const phase = (node.item.status === 'failed' ? failedPhase : undefined) ?? frontier;
    if (phase) phase.children.push(node);
    else stillUnassigned.push(node);
  }
  return stillUnassigned;
}

function findMatchingPhase(
  phaseRoots: readonly WorkflowTreeNode[],
  node: WorkflowTreeNode,
): WorkflowTreeNode | undefined {
  const phaseRef = normalizePhaseRef(node.item.phaseId);
  const titleRef = normalizePhaseRef(node.item.title);
  return phaseRoots.find((phase) => {
    const id = normalizePhaseRef(phase.item.id);
    const title = normalizePhaseRef(phase.item.title);
    return (
      (phaseRef.length > 0 && (phaseRef === id || phaseRef === title)) ||
      (titleRef.length > 0 && titleRef === title)
    );
  });
}

function normalizePhaseRef(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

// The phase the run is CURRENTLY working — where untagged agents belong. NEVER a
// future/last phase. Preference: explicit active phase (by id, then index) → the phase
// whose matched children are running → the first phase not yet finished → the first phase.
//
// Bug fixed here (#): the old per-agent fallback special-cased `status === 'running'` to
// anchor to the active phase, but let every OTHER status (i.e. completed) fall through to
// `phaseRoots.at(-1)` (the LAST phase). So running agents correctly stayed in the active
// phase while every *completed* sub-agent jumped into the final phase and lit it up as
// "done". Computing the frontier once (in attachLooseRootsToPhases) and sending all
// untagged agents there — regardless of status — is stable and matches the run's cursor.
function findFrontierPhase(
  phaseRoots: readonly WorkflowTreeNode[],
  run: WorkflowRunT,
): WorkflowTreeNode | undefined {
  const activeById = findActivePhaseById(phaseRoots, run.activePhaseId);
  if (activeById) return activeById;

  const running = phaseRoots.find((phase) => phaseStatusFromNode(phase) === 'running');
  if (running) return running;

  const activeByIndex = findActivePhaseByIndex(phaseRoots, run.activePhaseIndex);
  if (activeByIndex) return activeByIndex;

  const firstOpen = phaseRoots.find((phase) => {
    const status = phaseStatusFromNode(phase);
    return status !== 'completed' && status !== 'skipped' && status !== 'cancelled';
  });
  return firstOpen ?? phaseRoots[0];
}

function findActivePhaseById(
  phaseRoots: readonly WorkflowTreeNode[],
  activePhaseId: string | undefined,
): WorkflowTreeNode | undefined {
  const ref = normalizePhaseRef(activePhaseId);
  if (!ref) return undefined;
  return phaseRoots.find((phase) => {
    const id = normalizePhaseRef(phase.item.id);
    const title = normalizePhaseRef(phase.item.title);
    return ref === id || ref === title;
  });
}

function findActivePhaseByIndex(
  phaseRoots: readonly WorkflowTreeNode[],
  activePhaseIndex: number | undefined,
): WorkflowTreeNode | undefined {
  if (activePhaseIndex === undefined || !Number.isFinite(activePhaseIndex)) return undefined;
  const index = Math.floor(activePhaseIndex);
  return phaseRoots[index] ?? (index > 0 ? phaseRoots[index - 1] : undefined);
}

function phaseStatusFromNode(node: WorkflowTreeNode): WorkflowGraphStatus {
  const counts = countNodes(node.children.map((child) => graphNodeFromTreeNode(child, 'running')));
  return derivePhaseStatus(node.item.status, counts);
}

function derivePhaseStatus(
  declaredStatus: WorkflowProcessItemStatusT,
  counts: WorkflowGraphCounts,
): WorkflowGraphStatus {
  if (declaredStatus !== 'pending') return declaredStatus;
  if (counts.failed > 0) return 'failed';
  if (counts.running > 0) return 'running';
  if (counts.cancelled > 0) return 'cancelled';
  if (counts.total > 0 && counts.completed === counts.total) return 'completed';
  return declaredStatus;
}

function syntheticRunPhase(
  run: WorkflowRunT,
  roots: readonly WorkflowTreeNode[],
  index: number,
  total: number,
): WorkflowGraphPhase {
  const nodes = roots.map((node) => graphNodeFromTreeNode(node, run.status));
  const counts = countNodes(nodes);
  return {
    id: `${run.runId}:run`,
    title: run.displayName ?? run.workflowName,
    status: normalizeTerminalGraphStatus(run.status, runStatusToGraphStatus(run.status)),
    index,
    total,
    nodes,
    counts,
    activeLabel: findActiveLabel(nodes) ?? run.latestMessage,
  };
}

function graphNodeFromTreeNode(
  node: WorkflowTreeNode,
  runStatus: WorkflowRunT['status'],
): WorkflowGraphNode {
  const children = node.children.map((child) => graphNodeFromTreeNode(child, runStatus));
  return {
    id: node.item.id,
    title: node.item.title || node.item.id,
    kind: node.item.kind,
    status: normalizeTerminalGraphStatus(runStatus, node.item.status),
    children,
    descendantCount: children.reduce((sum, child) => sum + 1 + child.descendantCount, 0),
  };
}

function normalizeTerminalGraphStatus(
  runStatus: WorkflowRunT['status'],
  status: WorkflowGraphStatus,
): WorkflowGraphStatus {
  if (runStatus === 'running' || runStatus === 'paused') return status;
  if (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  ) {
    return status;
  }
  if (runStatus === 'completed') return 'completed';
  if (status === 'pending') return 'skipped';
  return runStatus;
}

function countNodes(nodes: readonly WorkflowGraphNode[]): WorkflowGraphCounts {
  const counts = { total: 0, completed: 0, running: 0, failed: 0, cancelled: 0 };
  const visit = (node: WorkflowGraphNode): void => {
    counts.total += 1;
    if (node.status === 'completed') counts.completed += 1;
    else if (node.status === 'running' || node.status === 'paused') counts.running += 1;
    else if (node.status === 'failed') counts.failed += 1;
    else if (node.status === 'cancelled') counts.cancelled += 1;
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return counts;
}

function findActiveLabel(nodes: readonly WorkflowGraphNode[]): string | undefined {
  for (const status of ['failed', 'running', 'paused'] satisfies readonly WorkflowGraphStatus[]) {
    const match = findFirst(nodes, (node) => node.status === status);
    if (match) return match.title;
  }
  return undefined;
}

function findFirst(
  nodes: readonly WorkflowGraphNode[],
  predicate: (node: WorkflowGraphNode) => boolean,
): WorkflowGraphNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = findFirst(node.children, predicate);
    if (child) return child;
  }
  return undefined;
}

function runStatusToGraphStatus(status: WorkflowRunT['status']): WorkflowGraphStatus {
  if (status === 'paused') return 'paused';
  return status;
}

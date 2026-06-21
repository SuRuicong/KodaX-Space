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
    phaseFromTreeNode(node, index + 1, total || phaseRoots.length),
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
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function phaseFromTreeNode(
  node: WorkflowTreeNode,
  index: number,
  total: number,
): WorkflowGraphPhase {
  const nodes = node.children.map(graphNodeFromTreeNode);
  const counts = countNodes(nodes);
  return {
    id: node.item.id,
    title: node.item.title || node.item.id,
    status: derivePhaseStatus(node.item.status, counts),
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

  const stillUnassigned: WorkflowTreeNode[] = [];
  for (const node of unassigned) {
    const phase = findFallbackPhase(phaseRoots, node, run);
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

function findFallbackPhase(
  phaseRoots: readonly WorkflowTreeNode[],
  node: WorkflowTreeNode,
  run: WorkflowRunT,
): WorkflowTreeNode | undefined {
  const activeById = findActivePhaseById(phaseRoots, run.activePhaseId);
  if (activeById) return activeById;

  if (node.item.status === 'running') {
    const activeByIndex = findActivePhaseByIndex(phaseRoots, run.activePhaseIndex);
    if (activeByIndex) return activeByIndex;
    const running = phaseRoots.find((phase) => phaseStatusFromNode(phase) === 'running');
    if (running) return running;
    return phaseRoots.find((phase) => phaseStatusFromNode(phase) === 'pending');
  }

  return undefined;
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
  const counts = countNodes(node.children.map(graphNodeFromTreeNode));
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
  const nodes = roots.map(graphNodeFromTreeNode);
  const counts = countNodes(nodes);
  return {
    id: `${run.runId}:run`,
    title: run.displayName ?? run.workflowName,
    status: runStatusToGraphStatus(run.status),
    index,
    total,
    nodes,
    counts,
    activeLabel: findActiveLabel(nodes) ?? run.latestMessage,
  };
}

function graphNodeFromTreeNode(node: WorkflowTreeNode): WorkflowGraphNode {
  const children = node.children.map(graphNodeFromTreeNode);
  return {
    id: node.item.id,
    title: node.item.title || node.item.id,
    kind: node.item.kind,
    status: node.item.status,
    children,
    descendantCount: children.reduce((sum, child) => sum + 1 + child.descendantCount, 0),
  };
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

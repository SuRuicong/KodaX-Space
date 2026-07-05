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
  const unassigned = attachLooseRootsToPhases(
    phaseRoots,
    roots.filter((node) => node.item.kind !== 'phase'),
  );
  const renderedPhaseCount = phaseRoots.length + (unassigned.length > 0 ? 1 : 0);
  const total =
    phaseRoots.length > 0 ? renderedPhaseCount : Math.max(run.phaseCount ?? 0, renderedPhaseCount);

  const phases: WorkflowGraphPhase[] = phaseRoots.map((node, index) =>
    phaseFromTreeNode(node, index + 1, total || phaseRoots.length, run.status),
  );

  if (unassigned.length > 0 || phases.length === 0) {
    // Reached only when there are NO declared phases (findMatchingPhase always places an
    // agent in its closest phase when any exist) — the whole run renders as one synthetic
    // phase titled by the workflow name.
    phases.push(
      syntheticRunPhase(
        run,
        unassigned,
        phases.length + 1,
        Math.max(total, 1),
        run.displayName ?? run.workflowName,
      ),
    );
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
): WorkflowTreeNode[] {
  const unassigned: WorkflowTreeNode[] = [];
  for (const node of looseRoots) {
    const phase = findMatchingPhase(phaseRoots, node);
    if (phase) phase.children.push(node);
    else unassigned.push(node);
  }
  return unassigned;
}

// Where a phaseId-less agent belongs. NEVER a frontier/current-phase guess — that made
// agents visibly migrate between phases as the run advanced (the reported bug). Matching is
// name-only, hence STATELESS: the same items always group the same way, whatever the run's
// progress. Every agent lands in its CLOSEST declared phase (see phaseNameAffinity) — a
// strong signal (exact title, shared tokens) wins first, and an agent with no overlap still
// gets its most character-similar phase rather than floating in an "unassigned" limbo. A
// deliberately-accepted trade: a mildly-wrong but stable home reads better than either the
// jumping bug or a separate bucket. Returns undefined only when there are no phases at all
// (generated runs with no declared phases → the caller renders one synthetic run phase).
function findMatchingPhase(
  phaseRoots: readonly WorkflowTreeNode[],
  node: WorkflowTreeNode,
): WorkflowTreeNode | undefined {
  const phaseRef = normalizePhaseRef(node.item.phaseId);
  if (phaseRef.length > 0) {
    const byId = phaseRoots.find((phase) => {
      const id = normalizePhaseRef(phase.item.id);
      const title = normalizePhaseRef(phase.item.title);
      return phaseRef === id || phaseRef === title;
    });
    if (byId) return byId;
  }
  if (phaseRoots.length === 0) return undefined;
  return closestPhaseByName(phaseRoots, normalizePhaseRef(node.item.title));
}

function closestPhaseByName(
  phaseRoots: readonly WorkflowTreeNode[],
  agentTitle: string,
): WorkflowTreeNode {
  let best = phaseRoots[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const phase of phaseRoots) {
    // Strict `>` means the earliest phase wins an exact tie — deterministic, so stable.
    const score = phaseNameAffinity(agentTitle, normalizePhaseRef(phase.item.title));
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return best;
}

// Higher = closer. Layered so a definite signal dominates a fuzzy one:
//   exact title          → 1000
//   token containment    → +100  (one title's tokens ⊆ the other, e.g. workflow ⊆ workflow-system)
//   shared-token Jaccard  → +10×  (reordered/overlapping tokens, e.g. tests-e2e ≡ e2e-tests)
//   character similarity → +1×   (baseline so there is always a "closest", e.g. synthesize↔synthesis)
function phaseNameAffinity(agentTitle: string, phaseTitle: string): number {
  if (agentTitle === phaseTitle) return 1000;
  const agentTokens = tokenSet(agentTitle);
  const phaseTokens = tokenSet(phaseTitle);
  const shared = [...agentTokens].filter((token) => phaseTokens.has(token)).length;
  const union = new Set([...agentTokens, ...phaseTokens]).size;
  const jaccard = union > 0 ? shared / union : 0;
  const contained = tokenContainment(agentTokens, phaseTokens) > 0 ? 1 : 0;
  const charSimilarity =
    1 - editDistance(agentTitle, phaseTitle) / Math.max(agentTitle.length, phaseTitle.length, 1);
  return contained * 100 + jaccard * 10 + charSimilarity;
}

function normalizePhaseRef(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9]+/i)
      .map((token) => token.toLowerCase())
      .filter(Boolean),
  );
}

// If one set is a subset of the other, return the shared-token count; otherwise 0. A mere
// partial overlap (neither set contains the other) is NOT a match — that distinction is
// what keeps an orphan like `provider-i18n-misc` out of every domain phase.
function tokenContainment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (!large.has(token)) return 0;
  return small.size;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
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
  title: string,
): WorkflowGraphPhase {
  const nodes = roots.map((node) => graphNodeFromTreeNode(node, run.status));
  const counts = countNodes(nodes);
  return {
    id: `${run.runId}:run`,
    title,
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

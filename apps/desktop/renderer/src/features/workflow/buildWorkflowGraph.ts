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
}

export function buildWorkflowGraphModel(run: WorkflowRunT): WorkflowGraphModel {
  const roots = buildItemTree(run.items);
  const phaseRoots = roots.filter((node) => node.item.kind === 'phase');
  const looseRoots = roots.filter((node) => node.item.kind !== 'phase');
  const total = Math.max(run.phaseCount ?? 0, phaseRoots.length + (looseRoots.length > 0 ? 1 : 0));

  const phases: WorkflowGraphPhase[] = phaseRoots.map((node, index) =>
    phaseFromTreeNode(node, index + 1, total || phaseRoots.length),
  );

  if (looseRoots.length > 0 || phases.length === 0) {
    phases.push(syntheticRunPhase(run, looseRoots, phases.length + 1, Math.max(total, 1)));
  }

  return { phases };
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
    status: node.item.status,
    index,
    total,
    nodes,
    counts,
    activeLabel: findActiveLabel(nodes),
  };
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

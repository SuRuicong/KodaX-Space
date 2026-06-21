import type { WorkflowRunT } from '@kodax-space/space-ipc-schema';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function workflowPhaseCounter(run: WorkflowRunT): string | undefined {
  const phase = deriveWorkflowPhase(run);
  if (!phase?.total || !phase.index) return undefined;
  return `${phase.index}/${phase.total}`;
}

export function workflowPhaseLabel(run: WorkflowRunT): string | undefined {
  const phase = deriveWorkflowPhase(run);
  if (!phase) return undefined;
  if (phase.total && phase.index) {
    return phase.title
      ? `phase ${phase.index}/${phase.total}: ${phase.title}`
      : `phase ${phase.index}/${phase.total}`;
  }
  return phase.title;
}

function deriveWorkflowPhase(
  run: WorkflowRunT,
): { index?: number; total?: number; title?: string } | null {
  const phases = run.items.filter((item) => item.kind === 'phase');
  const total =
    run.phaseCount !== undefined && run.phaseCount > 0
      ? run.phaseCount
      : phases.length > 0
        ? phases.length
        : undefined;

  const activeById =
    run.activePhaseId !== undefined
      ? phases.findIndex((item) => item.id === run.activePhaseId)
      : -1;
  const runningIndex = phases.findIndex((item) => item.status === 'running');
  const lastTouchedIndex = findLastIndex(
    phases,
    (item) => item.status !== 'pending' && item.status !== 'skipped',
  );
  const completedCount = phases.filter((item) => item.status === 'completed').length;
  const rawIndex = run.activePhaseIndex !== undefined ? run.activePhaseIndex + 1 : undefined;

  let index: number | undefined;
  if (run.status === 'completed' && total !== undefined) {
    index = total;
  } else if (TERMINAL.has(run.status) && total !== undefined) {
    index = Math.max(rawIndex ?? 0, completedCount, lastTouchedIndex + 1, 1);
  } else if (activeById >= 0) {
    index = activeById + 1;
  } else if (runningIndex >= 0) {
    index = runningIndex + 1;
  } else if (rawIndex !== undefined) {
    index = rawIndex;
  } else if (lastTouchedIndex >= 0) {
    index = lastTouchedIndex + 1;
  }

  if (index !== undefined && total !== undefined) {
    index = Math.min(total, Math.max(1, index));
  }

  const phaseByIndex = index !== undefined ? phases[index - 1] : undefined;
  const activePhase = activeById >= 0 ? phases[activeById] : undefined;
  const runningPhase = runningIndex >= 0 ? phases[runningIndex] : undefined;
  const title =
    phaseByIndex?.title ?? activePhase?.title ?? runningPhase?.title ?? run.activePhaseId;
  if (!total && !title) return null;
  return {
    ...(index !== undefined ? { index } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(title ? { title } : {}),
  };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}

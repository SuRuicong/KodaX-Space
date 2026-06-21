import { Loader2, PauseCircle } from 'lucide-react';
import type { WorkflowRunT } from '@kodax-space/space-ipc-schema';
import { useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import { workflowPhaseLabel } from '../features/workflow/workflowPhaseDisplay.js';

export function WorkflowWorkStrip(): JSX.Element | null {
  const runs = useSessionWorkflowRuns();
  const run = runs.find((r) => r.status === 'running' || r.status === 'paused');
  if (!run) return null;

  const name = run.displayName ?? run.workflowName;
  const phase = workflowPhaseLabel(run);
  const plannedTotal = Math.max(
    run.progress.plannedItems ?? 0,
    run.progress.spawnedAgents,
    run.progress.finishedAgents,
  );
  const active =
    run.progress.activeAgents > 0
      ? `${run.progress.activeAgents}/${plannedTotal || run.progress.activeAgents} active`
      : run.progress.spawnedAgents === 0
        ? 'waiting for agents'
        : undefined;
  const finished =
    plannedTotal > 0 ? `${run.progress.finishedAgents}/${plannedTotal} done` : undefined;
  const failed = run.progress.failedAgents > 0 ? `${run.progress.failedAgents} failed` : undefined;
  const stopped =
    run.progress.stoppedAgents > 0 ? `${run.progress.stoppedAgents} stopped` : undefined;
  const tokens = workflowTokenLabel(run);
  const elapsed = workflowElapsedLabel(run.elapsedMs);
  const message = run.latestMessage ?? (run.status === 'paused' ? 'paused' : 'running');
  const parts = compact([name, phase, active, finished, failed, stopped, tokens, elapsed, message]);
  const Icon = run.status === 'paused' ? PauseCircle : Loader2;

  return (
    <div
      className="px-3 text-[11px] font-mono text-fg-muted flex items-center gap-1.5 select-none"
      role="status"
      aria-label="workflow live status"
      data-testid="workflow-live-strip"
      title={parts.join(' - ')}
    >
      <Icon
        className={`w-3 h-3 text-warn flex-shrink-0 ${run.status === 'running' ? 'animate-spin' : ''}`}
        strokeWidth={2}
        aria-hidden
      />
      <span className="text-warn">Workflow</span>
      <span className="text-fg-faint">-</span>
      <span className="truncate">{parts.join(' - ')}</span>
    </div>
  );
}

function workflowTokenLabel(run: WorkflowRunT): string | undefined {
  if (!run.tokens) return undefined;
  if (run.tokens.total !== undefined && run.tokens.total > 0) {
    return `${formatCompactNumber(run.tokens.spent)}/${formatCompactNumber(run.tokens.total)} tok`;
  }
  return `${formatCompactNumber(run.tokens.spent)} tok`;
}

function workflowElapsedLabel(elapsedMs: number | undefined): string | undefined {
  if (elapsedMs === undefined || elapsedMs < 1000) return undefined;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${(minutes % 60).toString().padStart(2, '0')}m`;
}

function formatCompactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function compact<T>(items: readonly (T | undefined | null | false)[]): T[] {
  return items.filter(Boolean) as T[];
}

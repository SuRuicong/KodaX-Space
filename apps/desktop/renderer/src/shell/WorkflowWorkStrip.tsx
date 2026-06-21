import { Loader2, PauseCircle } from 'lucide-react';
import { useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';

export function WorkflowWorkStrip(): JSX.Element | null {
  const runs = useSessionWorkflowRuns();
  const run = runs.find((r) => r.status === 'running' || r.status === 'paused');
  if (!run) return null;

  const name = run.displayName ?? run.workflowName;
  const phase =
    run.phaseCount !== undefined && run.phaseCount > 0
      ? `phase ${(run.activePhaseIndex ?? 0) + 1}/${run.phaseCount}`
      : run.activePhaseId;
  const progress = `${run.progress.finishedAgents}/${run.progress.spawnedAgents}`;
  const active = run.progress.activeAgents > 0 ? `${run.progress.activeAgents} active` : undefined;
  const message = run.latestMessage ?? (run.status === 'paused' ? 'paused' : 'running');
  const parts = [name, phase, `${progress} agents`, active, message].filter(Boolean);
  const Icon = run.status === 'paused' ? PauseCircle : Loader2;

  return (
    <div
      className="px-3 text-[11px] font-mono text-fg-muted flex items-center gap-1.5 select-none"
      role="status"
      aria-label="workflow live status"
      data-testid="workflow-live-strip"
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

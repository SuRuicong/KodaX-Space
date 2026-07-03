import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Loader2,
  MinusCircle,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowRunT } from '@kodax-space/space-ipc-schema';
import {
  buildWorkflowGraphModel,
  type WorkflowGraphNode,
  type WorkflowGraphPhase,
  type WorkflowGraphStatus,
} from './buildWorkflowGraph.js';

const STATUS_ICON: Record<WorkflowGraphStatus, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  paused: PauseCircle,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
  skipped: MinusCircle,
};

const STATUS_TEXT: Record<WorkflowGraphStatus, string> = {
  pending: 'text-fg-faint',
  running: 'text-warn',
  paused: 'text-fg-muted',
  completed: 'text-ok',
  failed: 'text-danger',
  cancelled: 'text-fg-faint',
  skipped: 'text-fg-faint',
};

const DOT_CLASS: Record<WorkflowGraphStatus, string> = {
  pending: 'border-border-default bg-surface text-fg-faint',
  running: 'border-warn bg-warn/15 text-warn ring-2 ring-warn/10',
  paused: 'border-border-strong bg-surface-3 text-fg-muted',
  completed: 'border-ok bg-ok/15 text-ok',
  failed: 'border-danger bg-danger/15 text-danger',
  cancelled: 'border-border-strong bg-surface-3 text-fg-faint',
  skipped: 'border-border-default bg-surface text-fg-faint',
};

const CHIP_CLASS: Record<WorkflowGraphStatus, string> = {
  pending: 'border-border-default/50 text-fg-muted bg-surface/20',
  running: 'border-warn/60 text-warn bg-warn/10',
  paused: 'border-border-strong text-fg-muted bg-surface-3/70',
  completed: 'border-ok/50 text-ok bg-ok/10',
  failed: 'border-danger/60 text-danger bg-danger/10',
  cancelled: 'border-border-strong text-fg-faint bg-surface-3/60',
  skipped: 'border-border-default/50 text-fg-faint bg-surface/20',
};

export function WorkflowRunGraph({
  run,
}: {
  readonly run: WorkflowRunT;
}): JSX.Element | null {
  const model = buildWorkflowGraphModel(run);
  if (model.phases.length === 0) return null;

  // Only RUNTIME STATUS remains — the WORKFLOW DIAGRAM (pattern topology + phase
  // graph) was redundant with this live per-phase/per-agent list and was removed.
  return (
    <div className="mt-2 border-t border-border-default/40 pt-2" aria-label="Workflow runtime status">
      <div className="mb-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        Runtime status
      </div>
      <div className="space-y-0.5">
        {model.phases.map((phase, index) => (
          <WorkflowPhaseRow
            key={phase.id}
            phase={phase}
            isLast={index === model.phases.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowPhaseRow({
  phase,
  isLast,
}: {
  readonly phase: WorkflowGraphPhase;
  readonly isLast: boolean;
}): JSX.Element {
  const Icon = STATUS_ICON[phase.status];
  const phaseClass = phase.status === 'running' ? 'text-fg-primary' : 'text-fg-secondary';
  return (
    <div className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-2 pb-2 last:pb-0">
      {!isLast && (
        <span
          className={`absolute left-[7px] top-[18px] bottom-[-3px] w-px ${
            phase.status === 'completed' ? 'bg-ok/45' : 'bg-border-default'
          }`}
          aria-hidden
        />
      )}
      <span
        className={`z-[1] mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border ${DOT_CLASS[phase.status]}`}
        title={phase.status}
        aria-label={`phase status: ${phase.status}`}
      >
        <Icon
          size={10}
          strokeWidth={2.4}
          className={phase.status === 'running' ? 'animate-spin' : undefined}
          aria-hidden
        />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex-shrink-0 text-[10px] font-mono text-fg-faint tabular-nums">
            {phase.index}/{phase.total}
          </span>
          <span className={`truncate text-[11px] font-medium ${phaseClass}`} title={phase.title}>
            {phase.title}
          </span>
          <span className="ml-auto flex-shrink-0 text-[10px] font-mono text-fg-faint">
            {phaseStatsLabel(phase)}
          </span>
        </div>
        {phase.activeLabel && (
          <div className="mt-0.5 truncate text-[10px] text-fg-muted" title={phase.activeLabel}>
            {phase.activeLabel}
          </div>
        )}
        {phase.nodes.length > 0 && (
          // Show every sub-agent name — the right sidebar live panel has vertical
          // room (it scrolls). The old `+N` fold only existed for the REPL's cramped
          // TUI live area and hides useful info here.
          <div className="mt-1 flex flex-wrap gap-1">
            {phase.nodes.map((node) => (
              <WorkflowBranchChip key={node.id} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowBranchChip({ node }: { readonly node: WorkflowGraphNode }): JSX.Element {
  const Icon = STATUS_ICON[node.status];
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${CHIP_CLASS[node.status]}`}
      title={`${node.kind}: ${node.title}`}
    >
      <Icon
        size={9}
        strokeWidth={2.5}
        className={`flex-shrink-0 ${STATUS_TEXT[node.status]} ${
          node.status === 'running' ? 'animate-spin' : ''
        }`}
        aria-hidden
      />
      <span className="truncate">{node.title}</span>
      {node.descendantCount > 0 && (
        <span className="flex-shrink-0 font-mono text-fg-faint">+{node.descendantCount}</span>
      )}
    </span>
  );
}

function phaseStatsLabel(phase: WorkflowGraphPhase): string {
  const { counts } = phase;
  if (counts.failed > 0) return `${counts.failed} failed`;
  if (counts.cancelled > 0) return `${counts.cancelled} stopped`;
  if (counts.total === 0) return phase.status;
  if (counts.running > 0) return `${counts.completed}/${counts.total}`;
  return `${counts.completed}/${counts.total}`;
}

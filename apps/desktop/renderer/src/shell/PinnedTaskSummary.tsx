import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckSquare,
  CircleDot,
  GitCompare,
  Workflow,
} from 'lucide-react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import { useAppStore } from '../store/appStore.js';
import { buildTaskDockRunView, type TaskDockRunViewModel } from './taskDockProjection.js';
import { requestTaskDockFocus, type TaskDockSectionId } from './taskDockControl.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

interface SummaryChip {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
  readonly section: TaskDockSectionId;
  readonly icon: JSX.Element;
}

export function PinnedTaskSummary(): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const pendingSend = useAppStore((s) =>
    currentSessionId ? (s.pendingSendBySession[currentSessionId] ?? false) : false,
  );
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );
  const managedStatus = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const hasPermissionRequest = useAppStore((s) =>
    currentSessionId
      ? s.permissionQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const hasAskUserRequest = useAppStore((s) =>
    currentSessionId
      ? s.askUserQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const workflowRuns = useSessionWorkflowRuns();

  const view = buildTaskDockRunView({
    hasProject: currentProjectPath !== null,
    hasSession: currentSessionId !== null,
    pendingSend,
    todos,
    managedStatus,
    workflowRuns,
    events,
    budget,
    hasPermissionRequest,
    hasAskUserRequest,
  });

  const chips = useMemo(() => buildSummaryChips(view), [view]);
  const primaryTarget = view.primaryTarget ?? 'run';
  const shouldRender =
    currentProjectPath !== null ||
    currentSessionId !== null ||
    view.mode === 'attention' ||
    view.mode === 'running';
  if (!shouldRender) return null;

  return (
    <div
      className="ix-zone flex min-h-10 flex-shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3 py-1.5 text-[12px]"
      data-testid="pinned-task-summary"
    >
      <button
        type="button"
        onClick={() => requestTaskDockFocus(primaryTarget)}
        className={`group grid min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover-bg ${summaryToneClass(
          view.severity,
        )}`}
        title={summaryTitle(view)}
        aria-label={`Open ${primaryTarget} in Task Dock`}
        data-testid="pinned-summary-primary"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <CircleDot className={`h-3.5 w-3.5 ${summaryIconClass(view.severity)}`} strokeWidth={2} />
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium text-fg-primary">{view.headline}</span>
          {view.detail && (
            <span className="hidden min-w-0 truncate text-fg-muted md:inline">{view.detail}</span>
          )}
        </span>
      </button>

      {chips.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-1 overflow-hidden">
          {chips.map((chip) => (
            <SummaryChipButton key={chip.key} chip={chip} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryChipButton({ chip }: { readonly chip: SummaryChip }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => requestTaskDockFocus(chip.section)}
      className="inline-flex h-7 max-w-[120px] items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-fg-secondary transition-colors hover:bg-hover-bg hover:text-fg-primary"
      title={`Open ${chip.label} in Task Dock`}
      aria-label={`Open ${chip.label} in Task Dock`}
      data-testid={`pinned-summary-${chip.key}`}
    >
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-fg-muted">
        {chip.icon}
      </span>
      <span className="truncate">{chip.label}</span>
      {chip.value && <span className="font-mono tabular-nums text-fg-primary">{chip.value}</span>}
    </button>
  );
}

function buildSummaryChips(view: TaskDockRunViewModel): readonly SummaryChip[] {
  const chips = view.metrics.map((metric): SummaryChip => {
    const section = sectionForMetric(metric.label);
    const key = metric.label.toLowerCase();
    return {
      key,
      label: metric.label,
      value: metric.value,
      section,
      icon: iconForSection(section),
    };
  });

  if (view.mode === 'completed' && !chips.some((chip) => chip.section === 'changes')) {
    return [
      ...chips,
      {
        key: 'changes',
        label: 'Review',
        section: 'changes',
        icon: <GitCompare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
      },
    ];
  }
  if (view.mode === 'attention' && view.attentionKind) {
    return [
      {
        key: 'attention',
        label: attentionLabel(view.attentionKind),
        section: 'run',
        icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />,
      },
      ...chips,
    ];
  }
  return chips;
}

function sectionForMetric(label: string): TaskDockSectionId {
  switch (label) {
    case 'Plan':
      return 'plan';
    case 'Agents':
      return 'agents';
    case 'Workflow':
      return 'workflow';
    case 'Budget':
      return 'agents';
    default:
      return 'run';
  }
}

function iconForSection(section: TaskDockSectionId): JSX.Element {
  switch (section) {
    case 'plan':
      return <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'agents':
      return <Bot className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'workflow':
      return <Workflow className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    case 'changes':
      return <GitCompare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
    default:
      return <Activity className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />;
  }
}

function attentionLabel(kind: NonNullable<TaskDockRunViewModel['attentionKind']>): string {
  switch (kind) {
    case 'permission':
      return 'Permission';
    case 'ask_user':
      return 'Answer';
    case 'budget':
      return 'Budget';
    case 'error':
      return 'Error';
    case 'blocked':
      return 'Blocked';
  }
}

function summaryTitle(view: TaskDockRunViewModel): string {
  return view.detail ? `${view.headline} - ${view.detail}` : view.headline;
}

function summaryToneClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'text-fg-primary';
    case 'warning':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    case 'success':
      return 'text-ok';
    case 'info':
    case 'neutral':
      return 'text-fg-secondary';
  }
}

function summaryIconClass(severity: TaskDockRunViewModel['severity']): string {
  switch (severity) {
    case 'running':
      return 'animate-pulse text-run';
    case 'warning':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    case 'success':
      return 'text-ok';
    case 'info':
      return 'text-accent-ink';
    case 'neutral':
      return 'text-fg-faint';
  }
}

import type { SessionEvent, WorkflowRunT } from '@kodax-space/space-ipc-schema';
import { buildAgentStatuses } from './agentStatusProjection.js';

type TodoItem = {
  readonly id: string;
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  readonly activeForm?: string;
};

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];

export interface TaskDockMetric {
  readonly label: string;
  readonly value: string;
}

export interface TaskDockRunViewModel {
  readonly mode: 'no_project' | 'idle' | 'running' | 'attention' | 'error' | 'completed';
  readonly severity: 'neutral' | 'info' | 'running' | 'warning' | 'danger' | 'success';
  readonly headline: string;
  readonly detail?: string;
  readonly metrics: readonly TaskDockMetric[];
  readonly primaryTarget?:
    | 'run'
    | 'plan'
    | 'workflow'
    | 'agents'
    | 'changes'
    | 'sources'
    | 'artifacts'
    | 'context';
  readonly attentionKind?: 'permission' | 'ask_user' | 'budget' | 'error' | 'blocked';
}

export interface BuildTaskDockRunInput {
  readonly hasProject: boolean;
  readonly hasSession: boolean;
  readonly pendingSend: boolean;
  readonly todos?: readonly TodoItem[];
  readonly managedStatus?: ManagedTaskStatus;
  readonly workflowRuns?: readonly WorkflowRunT[];
  readonly events?: readonly SessionEvent[];
  readonly budget?: { readonly used: number; readonly cap: number };
  readonly hasPermissionRequest?: boolean;
  readonly hasAskUserRequest?: boolean;
}

export function buildTaskDockRunView(input: BuildTaskDockRunInput): TaskDockRunViewModel {
  if (!input.hasProject) {
    return {
      mode: 'no_project',
      severity: 'neutral',
      headline: 'Open a project to start',
      detail: 'Workspace actions and task context will appear here.',
      metrics: [],
      primaryTarget: 'run',
    };
  }

  if (input.hasPermissionRequest) {
    return attention('Permission needed', 'A tool call is waiting for approval.', 'permission');
  }
  if (input.hasAskUserRequest) {
    return attention('Answer needed', 'The agent is waiting for your response.', 'ask_user');
  }
  if (input.managedStatus?.budgetApprovalRequired) {
    return attention('Budget approval needed', 'Work is paused until the budget is approved.', 'budget');
  }

  const latestError = latestEventKind(input.events, 'session_error');
  if (latestError) {
    return {
      mode: 'error',
      severity: 'danger',
      headline: 'Run hit an error',
      detail: 'Open the run context for recovery details.',
      metrics: buildMetrics(input),
      primaryTarget: 'run',
      attentionKind: 'error',
    };
  }

  const activeWorkflow = input.workflowRuns?.find(
    (run) => run.status === 'running' || run.status === 'paused',
  );
  if (activeWorkflow) {
    return {
      mode: 'running',
      severity: 'running',
      headline: activeWorkflow.displayName || activeWorkflow.workflowName || 'Workflow running',
      detail: activeWorkflow.latestMessage ?? 'Workflow is active.',
      metrics: buildMetrics(input),
      primaryTarget: 'workflow',
    };
  }

  const agents = buildAgentStatuses(input.managedStatus);
  const activeAgent = agents.find((agent) => agent.state === 'active');
  if (activeAgent) {
    return {
      mode: 'running',
      severity: 'running',
      headline: `${activeAgent.title} is working`,
      detail: activeAgent.latest ?? activeAgent.responsibility ?? 'Agent work is active.',
      metrics: buildMetrics(input),
      primaryTarget: 'agents',
    };
  }

  const activeTodo = input.todos?.find((todo) => todo.status === 'in_progress');
  if (activeTodo) {
    return {
      mode: 'running',
      severity: 'running',
      headline: 'Plan in progress',
      detail: activeTodo.activeForm ?? activeTodo.content,
      metrics: buildMetrics(input),
      primaryTarget: 'plan',
    };
  }

  if (input.pendingSend) {
    return {
      mode: 'running',
      severity: 'running',
      headline: 'Sending message',
      detail: 'The current turn is starting.',
      metrics: buildMetrics(input),
      primaryTarget: 'run',
    };
  }

  if (latestEventKind(input.events, 'session_complete')) {
    return {
      mode: 'completed',
      severity: 'success',
      headline: 'Run complete',
      detail: 'Review changes, sources, and artifacts before moving on.',
      metrics: buildMetrics(input),
      primaryTarget: 'changes',
    };
  }

  return {
    mode: input.hasSession ? 'idle' : 'idle',
    severity: input.hasSession ? 'info' : 'neutral',
    headline: input.hasSession ? 'Ready for the next step' : 'Ready',
    detail: input.hasSession
      ? 'Task context will update as the agent works.'
      : 'Start or select a session to see run details.',
    metrics: buildMetrics(input),
    primaryTarget: 'run',
  };
}

function attention(
  headline: string,
  detail: string,
  kind: NonNullable<TaskDockRunViewModel['attentionKind']>,
): TaskDockRunViewModel {
  return {
    mode: 'attention',
    severity: 'warning',
    headline,
    detail,
    metrics: [],
    primaryTarget: 'run',
    attentionKind: kind,
  };
}

function buildMetrics(input: BuildTaskDockRunInput): readonly TaskDockMetric[] {
  const metrics: TaskDockMetric[] = [];
  const todos = input.todos ?? [];
  if (todos.length > 0) {
    const done = todos.filter((todo) => todo.status === 'completed').length;
    metrics.push({ label: 'Plan', value: `${done}/${todos.length}` });
  }
  const agents = buildAgentStatuses(input.managedStatus);
  if (agents.length > 0) {
    metrics.push({ label: 'Agents', value: String(agents.length) });
  }
  const activeWorkflowCount =
    input.workflowRuns?.filter((run) => run.status === 'running' || run.status === 'paused')
      .length ?? 0;
  if (activeWorkflowCount > 0) {
    metrics.push({ label: 'Workflow', value: String(activeWorkflowCount) });
  }
  if (input.budget) {
    metrics.push({ label: 'Budget', value: `${input.budget.used}/${input.budget.cap}` });
  }
  return metrics;
}

function latestEventKind(
  events: readonly SessionEvent[] | undefined,
  kind: SessionEvent['kind'],
): boolean {
  if (!events || events.length === 0) return false;
  for (let i = events.length - 1; i >= Math.max(0, events.length - 8); i--) {
    if (events[i]?.kind === kind) return true;
  }
  return false;
}

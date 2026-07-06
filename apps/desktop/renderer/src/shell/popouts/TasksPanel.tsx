import { useEffect, useMemo, useState } from 'react';
import { Caret } from '../../components/Caret.js';
import { useAppStore } from '../../store/appStore.js';
import {
  buildAgentStatuses,
  type AgentStatusViewModel,
} from '../agentStatusProjection.js';
import { buildWorkerTree, type WorkerNode } from './worker-tree.js';

type ManagedLiveKind = WorkerNode['latestKind'];

export function TasksPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );
  const harness = useAppStore((s) =>
    currentSessionId ? s.harnessProfileBySession[currentSessionId] : undefined,
  );

  const agents = useMemo(() => buildAgentStatuses(status), [status]);
  const workerById = useMemo(() => {
    const map = new Map<string, WorkerNode>();
    for (const worker of buildWorkerTree(status)) map.set(worker.workerId, worker);
    return map;
  }, [status]);

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        No active session.
      </div>
    );
  }

  const runningCount = agents.filter((agent) => agent.state === 'active').length;
  const completedCount = agents.filter((agent) => agent.state === 'completed').length;
  const waitingText = status?.idleWaiting
    ? `Waiting for ${status.idleWaitingPendingCount ?? 0} pending result${
        (status.idleWaitingPendingCount ?? 0) === 1 ? '' : 's'
      }`
    : status?.childFanoutCount !== undefined && status.childFanoutCount > 0
      ? `${status.childFanoutCount} active${status.childFanoutClass ? ` / ${status.childFanoutClass}` : ''}`
      : null;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <section className="rounded-lg border border-border-default bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-fg-muted">Agents</div>
            <div className="mt-0.5 text-sm font-medium text-fg-primary">
              {agents.length > 0 ? `${agents.length} delegated agent${agents.length === 1 ? '' : 's'}` : 'No delegated agents yet'}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {runningCount > 0 && <Metric label="Running" value={runningCount} />}
            {completedCount > 0 && <Metric label="Done" value={completedCount} />}
            {waitingText && <Metric label="State" value={waitingText} />}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <BudgetCard budget={budget} approvalRequired={status?.budgetApprovalRequired ?? false} />
          <HarnessCard harness={harness} status={status} />
        </div>
      </section>

      <section>
        {agents.length === 0 ? (
          <div className="rounded-lg border border-border-default bg-surface-2 p-3 text-fg-muted">
            Agents appear here when a task is delegated, split, or run in parallel.
          </div>
        ) : (
          <ul className="space-y-2">
            {agents.map((agent) => (
              <AgentPanelRow
                key={agent.id}
                agent={agent}
                worker={workerById.get(agent.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BudgetCard({
  budget,
  approvalRequired,
}: {
  readonly budget:
    | {
        readonly used: number;
        readonly cap: number;
      }
    | undefined;
  readonly approvalRequired: boolean;
}): JSX.Element {
  if (!budget) {
    return (
      <div className="rounded-md border border-border-default bg-surface p-2">
        <div className="text-[11px] uppercase tracking-wider text-fg-muted">Budget</div>
        <div className="mt-1 text-fg-faint">No budget data yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border-default bg-surface p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-fg-muted">Budget</div>
        {approvalRequired && <span className="text-[11px] text-warn">approval needed</span>}
      </div>
      <div className="mt-1 font-mono text-fg-secondary">
        {budget.used} / {budget.cap}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-surface-2">
        <div
          className="h-full bg-ok"
          style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function HarnessCard({
  harness,
  status,
}: {
  readonly harness:
    | {
        readonly profile: string;
        readonly round?: number;
      }
    | undefined;
  readonly status:
    | {
        readonly harnessProfile?: string;
        readonly currentRound?: number;
        readonly upgradeCeiling?: string;
      }
    | undefined;
}): JSX.Element {
  const profile = harness?.profile ?? status?.harnessProfile ?? 'Unknown';
  const round = harness?.round ?? status?.currentRound;

  return (
    <div className="rounded-md border border-border-default bg-surface p-2">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">Harness</div>
      <div className="mt-1 font-mono text-fg-secondary">
        {profile}
        {round !== undefined && <span className="text-fg-muted"> / round {round}</span>}
      </div>
      {status?.upgradeCeiling && status.upgradeCeiling !== profile && (
        <div className="mt-1 text-[11px] text-fg-muted">ceiling {status.upgradeCeiling}</div>
      )}
    </div>
  );
}

function AgentPanelRow({
  agent,
  worker,
}: {
  readonly agent: AgentStatusViewModel;
  readonly worker: WorkerNode | undefined;
}): JSX.Element {
  const [expanded, setExpanded] = useState(agent.state === 'active');

  useEffect(() => {
    if (agent.state === 'active') setExpanded(true);
  }, [agent.state]);

  return (
    <li
      className={`rounded-lg border ${agentBorderClass(agent.state)} bg-surface-2`}
      data-testid="task-panel-agent-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover-bg"
      >
        <span
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${agentDotClass(agent.state)}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg-primary" title={agent.title}>
              {agent.title}
            </span>
            <span className="flex-shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
              {agentStateLabel(agent.state)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-muted">
            {[agent.role, agent.responsibility].filter(Boolean).join(' / ') || 'Delegated work'}
          </span>
          {agent.latest && (
            <span className="mt-1 block text-[12px] leading-4 text-fg-secondary">
              {agent.latest}
            </span>
          )}
        </span>
        <Caret open={expanded} className="mt-0.5 flex-shrink-0 text-fg-faint" />
      </button>
      {expanded && (
        <div className="border-t border-border-default/60 px-3 py-2">
          <div className="mb-2 flex flex-wrap gap-1 text-[10px] text-fg-faint">
            {agent.evidenceCount !== undefined && <span>{agent.evidenceCount} notes</span>}
            {agent.traceCount !== undefined && <span>{agent.traceCount} trace events</span>}
          </div>
          {worker && worker.events.length > 0 ? (
            <ul className="space-y-1 border-l border-border-default/60 pl-2">
              {worker.events.map((event) => (
                <li key={event.key} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${traceDotClass(
                      event.kind,
                    )}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg-secondary" title={event.summary}>
                      {event.summary || event.kind}
                    </span>
                    {event.phase && (
                      <span className="block text-[11px] text-fg-faint">{event.phase}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-fg-faint">No trace events yet.</div>
          )}
        </div>
      )}
    </li>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}): JSX.Element {
  return (
    <span className="rounded border border-border-default bg-surface px-1.5 py-0.5 text-[11px] text-fg-secondary">
      <span className="text-fg-faint">{label}</span>{' '}
      <span className="font-mono text-fg-primary">{value}</span>
    </span>
  );
}

function agentBorderClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'border-run/40';
    case 'waiting':
      return 'border-warn/40';
    case 'completed':
      return 'border-ok/35';
    case 'error':
      return 'border-danger/40';
    case 'idle':
      return 'border-border-default';
  }
}

function agentDotClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'bg-run animate-pulse';
    case 'waiting':
      return 'bg-warn';
    case 'completed':
      return 'bg-ok';
    case 'error':
      return 'bg-danger';
    case 'idle':
      return 'bg-fg-faint';
  }
}

function traceDotClass(kind: ManagedLiveKind): string {
  switch (kind) {
    case 'completed':
      return 'bg-ok';
    case 'warning':
      return 'bg-warn';
    case 'notification':
      return 'bg-run';
    case 'progress':
      return 'bg-fg-faint';
    default:
      return 'bg-fg-muted';
  }
}

function agentStateLabel(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'completed':
      return 'Done';
    case 'error':
      return 'Issue';
    case 'idle':
      return 'Idle';
  }
}

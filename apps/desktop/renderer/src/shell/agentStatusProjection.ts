import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { buildWorkerTree } from './popouts/worker-tree.js';

type ManagedTaskStatus = Extract<SessionEvent, { kind: 'managed_task_status' }>['status'];

const EMPTY_AGENT_STATUSES: readonly AgentStatusViewModel[] = [];
const AGENT_STATUS_CACHE = new WeakMap<
  NonNullable<ManagedTaskStatus>,
  readonly AgentStatusViewModel[]
>();

export interface AgentStatusViewModel {
  readonly id: string;
  readonly title: string;
  readonly role?: string;
  readonly state: 'active' | 'waiting' | 'idle' | 'completed' | 'error';
  readonly responsibility?: string;
  readonly phase?: string;
  readonly latest?: string;
  readonly evidenceCount?: number;
  readonly traceCount?: number;
}

export function buildAgentStatuses(
  status: ManagedTaskStatus | undefined,
): readonly AgentStatusViewModel[] {
  if (!status) return EMPTY_AGENT_STATUSES;
  const cached = AGENT_STATUS_CACHE.get(status);
  if (cached) return cached;

  const workers = buildWorkerTree(status);
  const view = workers.map((worker) => {
    const latestKind = worker.latestKind;
    const state: AgentStatusViewModel['state'] = worker.isActive
      ? 'active'
      : latestKind === 'warning'
        ? 'error'
        : latestKind === 'completed'
          ? 'completed'
          : status?.idleWaiting
            ? 'waiting'
            : 'idle';

    const role = worker.isMain ? 'main agent' : inferRole(worker.workerTitle, worker.latestPhase);
    const responsibility = worker.latestPhase
      ? humanizePhase(worker.latestPhase)
      : worker.isActive
        ? 'Working'
        : undefined;

    return {
      id: worker.workerId,
      title: sanitizeWorkerTitle(worker.workerTitle),
      role,
      state,
      responsibility,
      phase: worker.latestPhase,
      latest: worker.latestSummary,
      traceCount: worker.events.length,
      evidenceCount: countEvidence(worker.events),
    };
  });
  AGENT_STATUS_CACHE.set(status, view);
  return view;
}

function sanitizeWorkerTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'Worker';
  if (/^[a-f0-9_-]{10,}$/i.test(trimmed)) return 'Worker';
  return trimmed;
}

function inferRole(title: string, phase: string | undefined): string | undefined {
  const source = `${title} ${phase ?? ''}`.toLowerCase();
  if (source.includes('research') || source.includes('source')) return 'research';
  if (source.includes('review') || source.includes('verify')) return 'review';
  if (source.includes('write') || source.includes('edit')) return 'implementation';
  if (source.includes('test')) return 'verification';
  return 'worker';
}

function humanizePhase(phase: string): string {
  return phase
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

function countEvidence(
  events: readonly NonNullable<ManagedTaskStatus['events']>[number][],
): number | undefined {
  let count = 0;
  for (const event of events) {
    if (event.summary && event.summary.trim().length > 0) count++;
  }
  return count > 0 ? count : undefined;
}

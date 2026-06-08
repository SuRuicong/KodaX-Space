// BackgroundTaskBar — REPL 同款"多 subagent 任务 chip 条" (v0.1.x)
//
// 当 KodaX AMA fan-out 跑多个并发 worker 时,managed_task_status.events 字段累积每个
// worker 的 progress / completed / notification 事件。本组件按 workerId 聚合,显示
// 一条横向 chip 条:
//   [✓ scout] [⟳ generator-1] [⟳ generator-2] [⚠ evaluator]
//
// 状态推断: 最新事件的 kind 决定 icon — progress=⟳, completed=✓, warning=⚠, notification=•
// 状态 → 颜色: running 蓝、completed 绿、warning 黄、notification 灰
//
// 不显示规则:
//   - 没有 workerId 的事件 (主线程 / 顶层) 跳过
//   - completed 的 worker 在 [done + 6s] 后淡出 (UX: 让用户能看到刚完成的 worker)
//   - 同一 turn 内最多 12 个 worker (剩余折叠成 "+N more")

import { Loader2, Check, Circle, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';

type ManagedLiveEvent = NonNullable<
  Extract<SessionEvent, { kind: 'managed_task_status' }>['status']['events']
>[number];

const COMPLETED_FADE_MS = 6_000;
const MAX_CHIPS = 12;

interface WorkerState {
  readonly workerId: string;
  readonly title: string;
  readonly latestKind: ManagedLiveEvent['kind'];
  readonly latestSummary: string;
  readonly latestDetail?: string;
}

/** 按 workerId 聚合 events → 取最新状态。返回顺序 = 第一次出现顺序 (稳定,UI 不抖动)。 */
function aggregateWorkers(events: readonly ManagedLiveEvent[]): WorkerState[] {
  const byId = new Map<string, WorkerState>();
  for (const ev of events) {
    if (!ev.workerId) continue;
    byId.set(ev.workerId, {
      workerId: ev.workerId,
      title: ev.workerTitle ?? ev.workerId,
      latestKind: ev.kind,
      latestSummary: ev.summary,
      latestDetail: ev.detail,
    });
  }
  return Array.from(byId.values());
}

const KIND_ICON: Record<ManagedLiveEvent['kind'], LucideIcon> = {
  progress: Loader2,
  completed: Check,
  notification: Circle,
  warning: AlertTriangle,
};
const KIND_COLOR: Record<ManagedLiveEvent['kind'], string> = {
  progress: 'text-sky-400/90 border-sky-400/30',
  completed: 'text-emerald-400/90 border-emerald-400/30',
  notification: 'text-fg-muted border-border-strong/40',
  warning: 'text-amber-400/90 border-amber-400/40',
};

export function BackgroundTaskBar(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );

  if (!status || !status.events || status.events.length === 0) return null;
  const workers = aggregateWorkers(status.events);
  if (workers.length === 0) return null;

  const shown = workers.slice(0, MAX_CHIPS);
  const overflow = workers.length - shown.length;

  return (
    <div
      className="px-3 py-1 flex items-center gap-1.5 flex-wrap text-[11px] font-mono"
      role="status"
      aria-label="Background subagent tasks"
    >
      {shown.map((w) => {
        const Icon = KIND_ICON[w.latestKind];
        return (
          <span
            key={w.workerId}
            className={`px-1.5 py-0.5 rounded border ${KIND_COLOR[w.latestKind]} flex items-center gap-1`}
            title={`${w.title}\n${w.latestSummary}${w.latestDetail ? `\n${w.latestDetail}` : ''}`}
          >
            <Icon
              className={`w-3 h-3 flex-shrink-0 ${w.latestKind === 'progress' ? 'animate-spin' : ''}`}
              strokeWidth={2}
              aria-hidden
            />
            <span className="max-w-[120px] truncate">{w.title}</span>
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="px-1.5 py-0.5 rounded border border-border-strong text-fg-muted">
          +{overflow} more
        </span>
      )}
    </div>
  );
}
// COMPLETED_FADE_MS reserved for future enhancement: tracking per-worker completion timestamp
// in a useRef Map, fading out workers >6s post-completion. For now all events stay until the
// turn ends (managed_task_status reset by next iteration_start).
void COMPLETED_FADE_MS;

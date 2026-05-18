// TasksPanel — F012-revised / alpha.1
//
// 装 KodaX managed task status：Work budget / harness profile / 当前 worker / 子 fanout / idle waiting。
// 数据来自 main 推送的 managed_task_status 事件（KodaX KodaXEvents.onManagedTaskStatus 直接映射）。
//
// 数据流：
//   KodaX runtime
//     ─ onManagedTaskStatus(status) ─►
//   RealKodaXSession.emit({ kind:'managed_task_status', status })
//     ─ pushToRenderer ─►
//   appStore.appendEvent → managedTaskStatusBySession[sid] = status
//     ─ subscribe ─►
//   TasksPanel 渲染
//
// 老 work_budget / harness_profile 事件继续保留，store 也从 managed_task_status 派生它们，
// 因此两条路并存（mock-session 走老路；real-session 走 managed_task_status）。

import { useAppStore } from '../../store/appStore.js';

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

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        No active session.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      {/* Active worker — 直接来自 managed_task_status */}
      {status?.activeWorkerTitle && (
        <section>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Active worker
          </div>
          <div className="text-zinc-200 font-medium">
            {status.activeWorkerTitle}
            {status.phase && (
              <span className="text-zinc-500 font-normal"> · {status.phase}</span>
            )}
          </div>
          {status.note && <div className="text-zinc-400 mt-0.5">{status.note}</div>}
        </section>
      )}

      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Work budget
        </div>
        {budget ? (
          <div className="space-y-1">
            <div className="text-zinc-300 font-mono">
              {budget.used} / {budget.cap}
              {status?.budgetApprovalRequired && (
                <span className="ml-2 text-amber-400">· approval required</span>
              )}
            </div>
            <div className="h-1.5 bg-zinc-900 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-600"
                style={{
                  width: `${Math.min(100, (budget.used / budget.cap) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="text-zinc-600">No data yet — start a session run.</div>
        )}
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Harness profile
        </div>
        {harness ? (
          <div className="text-zinc-300 font-mono">
            {harness.profile}
            {harness.round !== undefined && (
              <span className="text-zinc-500"> · round {harness.round}</span>
            )}
            {status?.upgradeCeiling && status.upgradeCeiling !== harness.profile && (
              <span className="text-zinc-500"> · ceiling {status.upgradeCeiling}</span>
            )}
          </div>
        ) : status?.harnessProfile ? (
          // KodaX 发的 harnessProfile 字符串可能不在老 enum 里 — fallback 显示原值
          <div className="text-zinc-300 font-mono">
            {status.harnessProfile}
            {status.currentRound !== undefined && (
              <span className="text-zinc-500"> · round {status.currentRound}</span>
            )}
          </div>
        ) : (
          <div className="text-zinc-600">Unknown — defaults to H0_DIRECT.</div>
        )}
      </section>

      {/* Subagent / child fanout */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Subagents
        </div>
        {status?.idleWaiting ? (
          <div className="text-zinc-400">
            Idle — waiting for {status.idleWaitingPendingCount ?? 0} child task
            {(status.idleWaitingPendingCount ?? 0) === 1 ? '' : 's'}
          </div>
        ) : status?.childFanoutCount !== undefined && status.childFanoutCount > 0 ? (
          <div className="text-zinc-300">
            <span className="font-mono">{status.childFanoutCount}</span> child task
            {status.childFanoutCount === 1 ? '' : 's'} active
            {status.childFanoutClass && (
              <span className="text-zinc-500"> · {status.childFanoutClass}</span>
            )}
          </div>
        ) : (
          <div className="text-zinc-600">No child tasks.</div>
        )}
      </section>

      {/* Recent managed events */}
      {status?.events && status.events.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Recent events
          </div>
          <ul className="space-y-1.5">
            {status.events.slice(-8).map((ev) => (
              <li key={ev.key} className="flex gap-2 items-start">
                <span
                  className={
                    'inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ' +
                    (ev.kind === 'completed'
                      ? 'bg-emerald-500'
                      : ev.kind === 'warning'
                        ? 'bg-amber-500'
                        : ev.kind === 'notification'
                          ? 'bg-sky-500'
                          : 'bg-zinc-500')
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-300 truncate">{ev.summary}</div>
                  {ev.workerTitle && (
                    <div className="text-[10px] text-zinc-600">
                      {ev.workerTitle}
                      {ev.phase && ` · ${ev.phase}`}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

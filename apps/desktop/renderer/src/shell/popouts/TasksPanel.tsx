// TasksPanel — F012-revised
//
// 装 F008 拆出来的：Work 预算 + harness profile。
// 后续可加：子 agent 任务列表 / subagent tree（F012 v0.1.1 重新打包）。

import { useAppStore } from '../../store/appStore.js';

export function TasksPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const budget = useAppStore((s) => (currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined));
  const harness = useAppStore((s) => (currentSessionId ? s.harnessProfileBySession[currentSessionId] : undefined));

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        No active session.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Work budget</div>
        {budget ? (
          <div className="space-y-1">
            <div className="text-zinc-300 font-mono">
              {budget.used} / {budget.cap}
            </div>
            <div className="h-1.5 bg-zinc-900 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-600"
                style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="text-zinc-600">No data yet — start a session run.</div>
        )}
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Harness profile</div>
        {harness ? (
          <div className="text-zinc-300 font-mono">
            {harness.profile}
            {harness.round !== undefined && <span className="text-zinc-500"> · round {harness.round}</span>}
          </div>
        ) : (
          <div className="text-zinc-600">Unknown — defaults to H0_DIRECT.</div>
        )}
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Subagents</div>
        <div className="text-zinc-600">Tree view — v0.1.1 F012.</div>
      </section>
    </div>
  );
}

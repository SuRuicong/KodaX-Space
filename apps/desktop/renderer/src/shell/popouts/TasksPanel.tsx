// TasksPanel — F012-revised (alpha.1) + F037 Subagent tree
//
// 装 KodaX managed task status：Work budget / harness profile / worker tree / idle waiting。
// 数据来自 main 推送的 managed_task_status 事件（KodaX KodaXEvents.onManagedTaskStatus 直接映射）。
//
// 数据流：
//   KodaX runtime
//     ─ onManagedTaskStatus(status) ─►
//   RealKodaXSession.emit({ kind:'managed_task_status', status })
//     ─ pushToRenderer ─►
//   appStore.appendEvent → managedTaskStatusBySession[sid] = status
//     ─ subscribe ─►
//   TasksPanel 渲染 + buildWorkerTree 聚合 events → 树状视图
//
// 老 work_budget / harness_profile 事件继续保留，store 也从 managed_task_status 派生它们。
//
// F037 替换原 "Subagents" + "Recent events" 两节为单一 worker tree：
//   每个 worker 一行（title + 状态 dot + phase）；点击展开看该 worker 的所有事件。
//   activeWorker 永远首位 + sky 高亮。

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { buildWorkerTree, type WorkerNode } from './worker-tree.js';
import { Caret } from '../../components/Caret.js';

type ManagedLiveKind = WorkerNode['latestKind'];

function kindDotClass(kind: ManagedLiveKind, isActive: boolean): string {
  if (isActive) return 'bg-run animate-pulse';
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

  // F037 reviewer MEDIUM-3: memoize 防 managed_task_status 高频更新时反复跑 grouping + sort。
  // ⚠️ 必须在任何 early return 之前调用 —— 否则 currentSessionId 在 null/非 null 间切换时
  //    hook 调用顺序变化，违反 Rules of Hooks（F054 lint 修复时发现的真实潜在 bug）。
  const workers = useMemo(() => buildWorkerTree(status), [status]);

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        No active session.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <section>
        <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5">Work budget</div>
        {budget ? (
          <div className="space-y-1">
            <div className="text-fg-secondary font-mono">
              {budget.used} / {budget.cap}
              {status?.budgetApprovalRequired && (
                <span className="ml-2 text-warn">· approval required</span>
              )}
            </div>
            <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
              <div
                className="h-full bg-ok"
                style={{
                  width: `${Math.min(100, (budget.used / budget.cap) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="text-fg-faint">No data yet — start a session run.</div>
        )}
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5">
          Harness profile
        </div>
        {harness ? (
          <div className="text-fg-secondary font-mono">
            {harness.profile}
            {harness.round !== undefined && (
              <span className="text-fg-muted"> · round {harness.round}</span>
            )}
            {status?.upgradeCeiling && status.upgradeCeiling !== harness.profile && (
              <span className="text-fg-muted"> · ceiling {status.upgradeCeiling}</span>
            )}
          </div>
        ) : status?.harnessProfile ? (
          <div className="text-fg-secondary font-mono">
            {status.harnessProfile}
            {status.currentRound !== undefined && (
              <span className="text-fg-muted"> · round {status.currentRound}</span>
            )}
          </div>
        ) : (
          <div className="text-fg-faint">Unknown — defaults to H0_DIRECT.</div>
        )}
      </section>

      {/* FEATURE_037: Worker tree —— 替代原 "Subagents" + "Recent events" */}
      <section>
        <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1.5 flex items-center justify-between">
          <span>Workers</span>
          {status?.idleWaiting && (
            <span className="text-fg-muted normal-case">
              idle · waiting {status.idleWaitingPendingCount ?? 0}
            </span>
          )}
          {!status?.idleWaiting &&
            status?.childFanoutCount !== undefined &&
            status.childFanoutCount > 0 && (
              <span className="text-fg-muted normal-case">
                {status.childFanoutCount} active
                {status.childFanoutClass ? ` · ${status.childFanoutClass}` : ''}
              </span>
            )}
        </div>
        {workers.length === 0 ? (
          <div className="text-fg-faint">No workers yet.</div>
        ) : (
          <ul className="space-y-0.5">
            {workers.map((w) => (
              <WorkerRow key={w.workerId} node={w} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WorkerRow({ node }: { node: WorkerNode }): JSX.Element {
  // 默认 expand：active worker；其它折叠
  const [expanded, setExpanded] = useState(node.isActive);

  // F037 reviewer MEDIUM-2: worker 从 inactive→active 切换时（KodaX 把控制权交给它）
  // 自动展开。用户后续可以再折叠——不强制保持展开。
  useEffect(() => {
    if (node.isActive) setExpanded(true);
  }, [node.isActive]);

  return (
    <li className="rounded">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 hover:bg-hover-bg ${
          node.isActive ? 'bg-run/30' : ''
        }`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${kindDotClass(
            node.latestKind,
            node.isActive,
          )}`}
          aria-label={`status: ${node.latestKind ?? 'pending'}`}
        />
        <span className="text-fg-secondary truncate flex-1">
          {node.workerTitle}
          {node.events.length > 0 && (
            <span className="text-fg-faint ml-1.5">({node.events.length})</span>
          )}
        </span>
        {node.latestPhase && (
          <span className="text-[11px] text-fg-muted font-mono">{node.latestPhase}</span>
        )}
        <Caret open={expanded} className="text-fg-faint" />
      </button>
      {expanded && node.events.length > 0 && (
        <ul className="ml-3 mt-0.5 mb-1 border-l border-border-default/60 pl-2 space-y-1">
          {node.events.map((ev) => (
            <li key={ev.key} className="flex gap-2 items-start">
              <span
                className={`inline-block w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${kindDotClass(
                  ev.kind,
                  false,
                )}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-fg-secondary truncate" title={ev.summary}>
                  {ev.summary}
                </div>
                {ev.phase && <div className="text-[11px] text-fg-faint">{ev.phase}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {expanded && node.events.length === 0 && (
        <div className="ml-5 mt-0.5 mb-1 text-[11px] text-fg-faint">No events yet.</div>
      )}
    </li>
  );
}

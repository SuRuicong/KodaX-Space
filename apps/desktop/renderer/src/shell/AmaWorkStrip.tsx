// AmaWorkStrip — P5
//
// Compact 一行指示器，AMA agent 形态时显示当前活跃 worker / harness / 子任务计数。
// 数据来源：managed_task_status 事件（appStore.managedTaskStatusBySession）。
//
// 显示规则：
//   - 仅 session.agentMode === 'ama' 时渲染
//   - 状态字段都缺时静默隐藏（避免空 strip 占位）
//   - 部分字段缺时只显示已有的，无 placeholder dash
//
// 视觉：font-mono、zinc-500、紫色 ✦ 前缀；点击预留 TasksPanel popout (TODO 接 CommandToolbar)。

import { Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore.js';

export function AmaWorkStrip(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );

  const session = sessions.find((x) => x.sessionId === currentSessionId);
  if (!session || session.agentMode !== 'ama') return null;
  if (!status) return null;

  const parts: string[] = [];
  if (status.activeWorkerTitle) {
    parts.push(status.activeWorkerTitle);
  }
  if (status.harnessProfile) {
    parts.push(status.harnessProfile);
  }
  if (status.currentRound !== undefined) {
    const round = status.maxRounds
      ? `round ${status.currentRound}/${status.maxRounds}`
      : `round ${status.currentRound}`;
    parts.push(round);
  }
  if (status.childFanoutCount !== undefined && status.childFanoutCount > 0) {
    const label = status.childFanoutClass
      ? `${status.childFanoutCount} ${status.childFanoutClass}`
      : `${status.childFanoutCount} active`;
    parts.push(label);
  }
  if (status.idleWaiting) {
    parts.push(`idle (${status.idleWaitingPendingCount ?? 0} pending)`);
  }
  if (status.budgetApprovalRequired) {
    parts.push('budget approval ⚠');
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="px-3 text-[11px] font-mono text-fg-muted flex items-center gap-1.5 select-none"
      role="status"
      aria-label="AMA work status"
    >
      <Sparkles className="w-3 h-3 text-thinking flex-shrink-0" strokeWidth={2} aria-hidden />
      <span className="text-fg-muted">AMA</span>
      <span className="text-fg-faint">·</span>
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  );
}

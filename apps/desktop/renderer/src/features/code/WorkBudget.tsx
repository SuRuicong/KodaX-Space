// WorkBudget — F008 顶栏中段的工作预算进度条。
//
// 设计：
//   - 进度条 0%~100%；颜色随使用率变化（绿 → 黄 → 红）
//   - 90% 阈值显示红点告警（PRD § 6.5）
//   - 文本格式 "Work x/y" + 百分比
//   - undefined 时（session 没收到过 work_budget 事件）显示 "Work —"，
//     不假装是 0/200——避免给用户错觉以为"才刚开始"

interface WorkBudgetProps {
  readonly budget: { used: number; cap: number } | undefined;
}

export function WorkBudget({ budget }: WorkBudgetProps): JSX.Element {
  if (!budget) {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-muted font-mono">
        <span>Work —</span>
        <div className="w-24 h-1.5 rounded-full bg-surface-3" />
      </div>
    );
  }

  const pct = budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;
  const isWarn = pct >= 75 && pct < 90;
  const isCritical = pct >= 90;

  // 进度条颜色 + 文字颜色随使用率渐变——红色出现说明该考虑 cancel
  const barColor = isCritical ? 'bg-danger' : isWarn ? 'bg-warn' : 'bg-ok';
  const textColor = isCritical ? 'text-danger' : isWarn ? 'text-warn' : 'text-fg-secondary';

  return (
    <div
      className="flex items-center gap-2 text-xs font-mono"
      title={`Work budget: ${budget.used} of ${budget.cap} (${pct}%)`}
    >
      <span className={textColor}>
        Work {budget.used}/{budget.cap}
      </span>
      <div className="w-24 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isCritical && (
        <span
          className="w-2 h-2 rounded-full bg-danger animate-pulse"
          aria-label="budget critical"
          title="≥ 90% budget consumed — consider cancelling or wrapping up"
        />
      )}
    </div>
  );
}

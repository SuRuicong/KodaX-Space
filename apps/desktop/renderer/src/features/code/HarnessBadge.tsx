// HarnessBadge — F008 顶栏 H0/H1/H2 徽标。
//
// 显示策略：
//   - H0_DIRECT 灰色，"DIRECT"
//   - H1_EXECUTE_EVAL 蓝色，"H1 · Round N"
//   - H2_PLAN_EXECUTE_EVAL 紫色，"H2 · Round N"
//   - undefined（profile 未推过）→ 灰色 "H0"（保守假设，且能识别"还没有 harness 信号"）
//
// 颜色逻辑（PRD § 6.4）：profile 升级表示 agent 觉得任务变难——颜色变深给用户即时反馈

interface HarnessBadgeProps {
  readonly profile:
    | { profile: 'H0_DIRECT' | 'H1_EXECUTE_EVAL' | 'H2_PLAN_EXECUTE_EVAL'; round?: number }
    | undefined;
}

export function HarnessBadge({ profile }: HarnessBadgeProps): JSX.Element {
  const kind = profile?.profile ?? 'H0_DIRECT';

  const styles = {
    H0_DIRECT: {
      bg: 'bg-surface-3',
      text: 'text-fg-muted',
      label: 'DIRECT',
      title: 'H0: single-step direct execution',
    },
    H1_EXECUTE_EVAL: {
      bg: 'bg-info/15',
      text: 'text-info',
      label: profile?.round ? `H1 · Round ${profile.round}` : 'H1',
      title: 'H1: execute + self-evaluate',
    },
    H2_PLAN_EXECUTE_EVAL: {
      bg: 'bg-thinking/15',
      text: 'text-thinking',
      label: profile?.round ? `H2 · Round ${profile.round}` : 'H2',
      title: 'H2: plan + execute + evaluate',
    },
  }[kind];

  return (
    <span
      className={`px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded ${styles.bg} ${styles.text}`}
      title={styles.title}
    >
      {styles.label}
    </span>
  );
}

// NotificationsSurface — 持久内联通知 (REPL NotificationsSurface 等价, v0.1.x)
//
// 与 ToastContainer 的区别:
//   - Toast: 几秒自动消失,适合 ephemeral 反馈 (复制成功 / IPC 错)
//   - 这里:  持续显示,直到用户 dismiss 或来源条件消失。eg "Auto-mode fell back to rules"
//     这种系统级状态用户必须确认 — 不能用一闪而过的 toast 处理。
//
// 来源 (当前 v0.1.x 触发器):
//   - auto_engine_change with reason ∈ {'denial_threshold', 'circuit_breaker'} (manual 不弹)
//   - 后续: context 80% warning / 反复 retry / network down 等
//
// session 过滤: notice.sessionId 与 currentSessionId 不匹配且非全局 (undefined sessionId) 时不显示。

import { useAppStore } from '../store/appStore.js';
import type { Notification } from '../store/appStore.js';

// 双主题色: 暗模式延续原 zinc-900 衬底家族,亮模式用深色文字 + 浅暖/冷衬底保证对比度。
// 选择 deep-700/800 文字色 + light-100/70 衬底是为了 WCAG AA (4.5:1) 以上对比。
const SEVERITY_BG: Record<Notification['severity'], string> = {
  info:
    'text-sky-800 bg-sky-100/70 border-sky-300 ' +
    'dark:text-sky-200 dark:bg-sky-900/20 dark:border-sky-700/40',
  warning:
    'text-amber-800 bg-amber-100/70 border-amber-300 ' +
    'dark:text-amber-200 dark:bg-amber-900/20 dark:border-amber-700/40',
  error:
    'text-red-800 bg-red-100/70 border-red-400 ' +
    'dark:text-red-200 dark:bg-red-900/30 dark:border-red-700/40',
};
const SEVERITY_ICON: Record<Notification['severity'], string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✖',
};

export function NotificationsSurface(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);

  // 只显示: 全局通知 (sessionId 未设) 或 sessionId 匹配当前 session
  const visible = notifications.filter(
    (n) => n.sessionId === undefined || n.sessionId === currentSessionId,
  );
  if (visible.length === 0) return null;

  return (
    <div className="px-3 space-y-1" role="region" aria-label="System notifications">
      {visible.map((n) => (
        <div
          key={n.id}
          className={`px-2 py-1 rounded border text-xs flex items-start gap-2 ${SEVERITY_BG[n.severity]}`}
        >
          <span aria-hidden className="mt-px">
            {SEVERITY_ICON[n.severity]}
          </span>
          <span className="flex-1 leading-snug">{n.text}</span>
          <button
            type="button"
            onClick={() => dismissNotification(n.id)}
            className="text-fg-muted hover:text-fg-primary text-[12px] leading-none"
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { Notification } from '../store/appStore.js';

// 双主题色: 暗模式延续原 zinc-900 衬底家族,亮模式用深色文字 + 浅暖/冷衬底保证对比度。
// 选择 deep-700/800 文字色 + light-100/70 衬底是为了 WCAG AA (4.5:1) 以上对比。
const SEVERITY_BG: Record<Notification['severity'], string> = {
  info: 'text-run bg-run/15 border-run/40',
  warning: 'text-warn bg-warn/15 border-warn/40',
  error: 'text-danger bg-danger/15 border-danger/40',
};
const SEVERITY_ICON: Record<Notification['severity'], string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✖',
};

interface NotificationRowProps {
  readonly notification: Notification;
  readonly onDismiss: (id: string) => void;
}

function NotificationRow({ notification, onDismiss }: NotificationRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [closeSide, setCloseSide] = useState(28);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const updateCloseSide = (): void => {
      const next = Math.max(24, Math.ceil(row.getBoundingClientRect().height));
      setCloseSide((prev) => (prev === next ? prev : next));
    };

    updateCloseSide();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateCloseSide);
    observer.observe(row);
    return () => observer.disconnect();
  }, [notification.text]);

  return (
    <div
      ref={rowRef}
      className={`relative overflow-hidden pl-2 py-1 rounded border text-xs flex items-start gap-2 ${SEVERITY_BG[notification.severity]}`}
      style={{ paddingRight: closeSide }}
    >
      <span aria-hidden className="mt-px">
        {SEVERITY_ICON[notification.severity]}
      </span>
      <span className="flex-1 leading-snug">{notification.text}</span>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        className="absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-r text-base leading-none text-fg-muted hover:bg-surface-3 hover:text-fg-primary"
        style={{ width: closeSide, height: closeSide }}
        title="Dismiss"
        aria-label="Dismiss notification"
      >
        {'\u00d7'}
      </button>
    </div>
  );
}

export function NotificationsSurface(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Visible: global notifications or notifications for the current session.
  const visible = useMemo(
    () =>
      notifications.filter((n) => n.sessionId === undefined || n.sessionId === currentSessionId),
    [currentSessionId, notifications],
  );
  const dismissOnOutsideInteractionIds = useMemo(
    () => visible.filter((n) => n.dismissOnOutsideInteraction).map((n) => n.id),
    [visible],
  );

  useEffect(() => {
    if (dismissOnOutsideInteractionIds.length === 0) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      for (const id of dismissOnOutsideInteractionIds) dismissNotification(id);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [dismissNotification, dismissOnOutsideInteractionIds]);
  if (visible.length === 0) return null;

  return (
    <div ref={rootRef} className="px-3 space-y-1" role="region" aria-label="System notifications">
      {visible.map((n) => (
        <NotificationRow key={n.id} notification={n} onDismiss={dismissNotification} />
      ))}
    </div>
  );
}

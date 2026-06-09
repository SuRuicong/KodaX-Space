// P4d ToastContainer — 右下角浮窗 stack。
//
// 显示 pushToast 推进来的瞬态消息。tone 决定颜色 + 默认 ttl；用户也可以 × 手动关。
// 不需要订阅 sessionId / projectPath 等业务状态，与 Shell 解耦。

import type { Toast, ToastTone } from '../store/toastStore.js';
import { useToastStore } from '../store/toastStore.js';

// Dark：深色 bg + 浅色 text；Light：浅色 bg + 深色 text。
// 之前只写 dark-only，文字经全局反转后跟 bg 同深 → 看不清 (用户反馈：Stop 后弹窗黑乎乎)。
const TONE_CLASS: Record<ToastTone, string> = {
  info: 'bg-surface-2 border-border-strong text-fg-primary',
  success: 'bg-surface-2 border-ok/50 text-ok',
  warning: 'bg-surface-2 border-warn/50 text-warn',
  error: 'bg-surface-2 border-danger/50 text-danger',
};

const TONE_ICON: Record<ToastTone, string> = {
  info: 'ⓘ',
  success: '✓',
  warning: '!',
  error: '✕',
};

export function ToastContainer(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t: Toast) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded border text-xs shadow-lg ${TONE_CLASS[t.tone]}`}
        >
          <span className="font-mono leading-tight" aria-hidden>
            {TONE_ICON[t.tone]}
          </span>
          <div className="flex-1 whitespace-pre-wrap break-words">{t.message}</div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="dark:text-fg-muted dark:hover:text-white text-fg-muted hover:text-fg-primary px-0.5 leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

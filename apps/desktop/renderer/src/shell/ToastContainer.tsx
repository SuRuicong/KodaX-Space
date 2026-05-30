// P4d ToastContainer — 右下角浮窗 stack。
//
// 显示 pushToast 推进来的瞬态消息。tone 决定颜色 + 默认 ttl；用户也可以 × 手动关。
// 不需要订阅 sessionId / projectPath 等业务状态，与 Shell 解耦。

import type { Toast, ToastTone } from '../store/toastStore.js';
import { useToastStore } from '../store/toastStore.js';

// Dark：深色 bg + 浅色 text；Light：浅色 bg + 深色 text。
// 之前只写 dark-only，文字经全局反转后跟 bg 同深 → 看不清 (用户反馈：Stop 后弹窗黑乎乎)。
const TONE_CLASS: Record<ToastTone, string> = {
  info: 'dark:bg-zinc-800/95 dark:border-zinc-700 dark:text-zinc-100 bg-zinc-100 border-zinc-300 text-zinc-900',
  success: 'dark:bg-emerald-900/90 dark:border-emerald-700 dark:text-emerald-100 bg-emerald-50 border-emerald-300 text-emerald-900',
  warning: 'dark:bg-amber-900/90 dark:border-amber-700 dark:text-amber-100 bg-amber-50 border-amber-300 text-amber-900',
  error: 'dark:bg-red-900/90 dark:border-red-700 dark:text-red-100 bg-red-50 border-red-300 text-red-900',
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
            className="dark:text-zinc-400 dark:hover:text-white text-zinc-500 hover:text-zinc-900 px-0.5 leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

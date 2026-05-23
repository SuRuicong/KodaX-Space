// P4d ToastContainer — 右下角浮窗 stack。
//
// 显示 pushToast 推进来的瞬态消息。tone 决定颜色 + 默认 ttl；用户也可以 × 手动关。
// 不需要订阅 sessionId / projectPath 等业务状态，与 Shell 解耦。

import type { Toast, ToastTone } from '../store/toastStore.js';
import { useToastStore } from '../store/toastStore.js';

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'bg-zinc-800/95 border-zinc-700 text-zinc-100',
  success: 'bg-emerald-900/90 border-emerald-700 text-emerald-100',
  warning: 'bg-amber-900/90 border-amber-700 text-amber-100',
  error: 'bg-red-900/90 border-red-700 text-red-100',
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
            className="text-zinc-400 hover:text-white px-0.5 leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

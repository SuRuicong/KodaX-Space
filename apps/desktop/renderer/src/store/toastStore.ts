// P4d toastStore — 一次性短反馈（"copied"、"stopping"、"failed to write to clipboard"）。
//
// 与 appStore 分开：toast 是纯 UI / 短生命周期状态，跟 session / project 无关，
// 也不需要 selector 反复 re-render。独立 store 让消费者订阅时不连带 wake up
// 所有 appStore subscriber。
//
// API：
//   useToastStore.getState().push("text", "success"?, ttl?)
//   useToastStore((s) => s.toasts) — 订阅当前队列
//
// auto-dismiss 由 push 内 setTimeout 负责；用 id 而非引用，store 数组替换不影响 timer。

import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
  /** 自动消失时间（ms）；0 = 手动关 */
  readonly ttl: number;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  push(message: string, tone?: ToastTone, ttl?: number): void;
  dismiss(id: string): void;
  clear(): void;
}

let counter = 0;

const DEFAULT_TTL: Record<ToastTone, number> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 6000,
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info', ttl) => {
    counter += 1;
    const id = `toast_${counter}`;
    const effectiveTtl = ttl ?? DEFAULT_TTL[tone];
    const toast: Toast = { id, message, tone, ttl: effectiveTtl };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (effectiveTtl > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, effectiveTtl);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** 便捷 helper — 业务代码不必持有 zustand handle。 */
export function pushToast(message: string, tone: ToastTone = 'info', ttl?: number): void {
  useToastStore.getState().push(message, tone, ttl);
}

// ConfirmDialog — 应用内确认弹窗，替代原生 window.confirm（见 confirmStore 头部说明）。
//
// 渲染在 Shell 顶层，订阅 confirmStore.current。无挂起请求时 return null（不留遮罩）。
// 关闭后派发 kodax-space.focus-textarea，把焦点交还输入栏——因为没有原生对话框，
// webContents 始终持有 OS 焦点，这个 focus() 一定生效。
//
// 键盘：Enter = 确认，Esc = 取消。打开时默认聚焦确认按钮（danger 时聚焦取消更稳妥，
// 避免误回车删除——但这里保持聚焦确认按钮以贴合原 window.confirm 行为，danger 用红色提示）。

import { useEffect, useRef } from 'react';
import { useConfirmStore } from '../store/confirmStore.js';
import { Portal } from '../components/Portal.js';

export function ConfirmDialog(): JSX.Element | null {
  const current = useConfirmStore((s) => s.current);
  const settle = useConfirmStore((s) => s.settle);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const id = current?.id;

  useEffect(() => {
    if (id === undefined) return undefined;
    // 打开时聚焦确认按钮，让 Enter/Space 立即可用且形成 focus trap 起点。
    requestAnimationFrame(() => confirmBtnRef.current?.focus());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        settle(id, false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        settle(id, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, settle]);

  if (!current) return null;

  const close = (ok: boolean): void => {
    settle(current.id, ok);
    // 交还焦点给 composer；BottomBar 监听该事件做多帧重试聚焦。
    window.dispatchEvent(new Event('kodax-space.focus-textarea'));
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(e) => {
          // 点遮罩（非卡片）= 取消
          if (e.target === e.currentTarget) close(false);
        }}
      >
        <div
          className={`glass lift ix-zone w-[420px] max-w-[92vw] flex flex-col bg-surface-2 border rounded-lg ${
            current.danger ? 'border-danger/50' : 'border-border-default'
          }`}
        >
          <div className="px-5 pt-4 pb-3">
            {current.title && (
              <h2
                id="confirm-dialog-title"
                className="text-sm font-semibold text-fg-primary mb-1.5"
              >
                {current.title}
              </h2>
            )}
            <p className="text-sm text-fg-secondary whitespace-pre-line">{current.message}</p>
          </div>
          <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => close(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-border-default text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
            >
              {current.cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={() => close(true)}
              className={`px-3 py-1.5 text-xs rounded-md text-white ${
                current.danger ? 'bg-danger hover:brightness-110' : 'btn-accent'
              }`}
            >
              {current.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

import { useRef } from 'react';
import { useConfirmStore } from '../store/confirmStore.js';
import { FloatingSurfaceHost } from './FloatingSurfaceHost.js';
import { floatingSurfaceForBlockingModal } from './floatingSurfacePolicy.js';

const CONFIRM_SURFACE = floatingSurfaceForBlockingModal(
  'confirm-dialog',
  'Confirm action',
  'outside_or_escape',
);

export function ConfirmDialog(): JSX.Element | null {
  const current = useConfirmStore((s) => s.current);
  const settle = useConfirmStore((s) => s.settle);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  if (!current) return null;

  const close = (ok: boolean): void => {
    settle(current.id, ok);
    window.dispatchEvent(new Event('kodax-space.focus-textarea'));
  };

  return (
    <FloatingSurfaceHost
      surface={CONFIRM_SURFACE}
      onClose={() => close(false)}
      role="dialog"
      ariaLabel={current.title ? undefined : CONFIRM_SURFACE.label}
      ariaLabelledBy={current.title ? 'confirm-dialog-title' : undefined}
      initialFocusRef={confirmBtnRef}
      onEnterKey={() => {
        close(true);
      }}
      contentClassName="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className={`glass lift ix-zone pointer-events-auto w-[420px] max-w-[92vw] flex flex-col bg-surface-2 border rounded-lg ${
          current.danger ? 'border-danger/50' : 'border-border-default'
        }`}
      >
        <div className="px-5 pt-4 pb-3">
          {current.title && (
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-fg-primary mb-1.5">
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
    </FloatingSurfaceHost>
  );
}

// InputBox —— 多行 textarea，自动 grow 到 8 行，⌘/Ctrl+Enter 发送。
//
// 受控组件：value / onChange 由父级管理（父级要 onSubmit 时 clear；EventStream 做这个）。

import { useEffect, useRef } from 'react';

interface InputBoxProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}

const MIN_ROWS = 1;
const MAX_ROWS = 8;
const LINE_HEIGHT_PX = 20;
const VERTICAL_PADDING_PX = 16;

export function InputBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
  placeholder = 'Type a prompt... (⌘/Ctrl+Enter to send)',
}: InputBoxProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: 重置 height 后按 scrollHeight 算实际行数
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const desired = Math.min(
      Math.max(el.scrollHeight, MIN_ROWS * LINE_HEIGHT_PX + VERTICAL_PADDING_PX),
      MAX_ROWS * LINE_HEIGHT_PX + VERTICAL_PADDING_PX,
    );
    el.style.height = `${desired}px`;
  }, [value]);

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={MIN_ROWS}
        className="flex-1 px-3 py-2 text-sm rounded bg-zinc-950 border border-zinc-800 font-mono text-zinc-100 resize-none focus:outline-none focus:border-blue-700 disabled:opacity-50"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (value.trim() !== '' && !disabled) onSubmit();
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || value.trim() === ''}
        className="text-sm px-3 py-2 rounded bg-blue-700/80 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white self-stretch"
      >
        Send
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 self-stretch"
          title="Cancel current run"
        >
          ⏹
        </button>
      )}
    </div>
  );
}

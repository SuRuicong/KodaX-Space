// TranscriptViewMenu — alpha.1
//
// Claude Desktop 截图 7：右上小按钮，点击弹出：
//   ┌─────────────────────────┐
//   │ Transcript view  Ctrl O │
//   │   Normal       ✓        │
//   │   Thinking              │
//   │   Verbose               │
//   │   Summary               │
//   │   [Aa] [Aa] [Aa]        │
//   └─────────────────────────┘
//
// 4 个 transcript view 模式 + 3 档字号。Ctrl+O 切换打开。

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

const VIEW_OPTIONS = [
  { key: 'normal' as const, label: 'Normal' },
  { key: 'thinking' as const, label: 'Thinking' },
  { key: 'verbose' as const, label: 'Verbose' },
  { key: 'summary' as const, label: 'Summary' },
];

const FONT_OPTIONS = [
  { key: 'sm' as const, label: 'Aa', cls: 'text-[10px]' },
  { key: 'base' as const, label: 'Aa', cls: 'text-xs' },
  { key: 'lg' as const, label: 'Aa', cls: 'text-sm' },
];

export function TranscriptViewMenu(): JSX.Element {
  const view = useAppStore((s) => s.transcriptView);
  const setView = useAppStore((s) => s.setTranscriptView);
  const fontSize = useAppStore((s) => s.transcriptFontSize);
  const setFont = useAppStore((s) => s.setTranscriptFontSize);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`px-2 py-1 text-[11px] rounded font-mono ${
          open ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/50'
        }`}
        title="Transcript view (Ctrl+O)"
        aria-label="Transcript view"
      >
        <span aria-hidden>▤</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50">
          <div className="px-3 py-1 flex justify-between items-center text-zinc-500 text-[10px] uppercase tracking-wider">
            <span>Transcript view</span>
            <span className="font-mono text-zinc-400 flex items-center gap-1">
              <kbd className="px-1 border border-zinc-700 rounded">Ctrl</kbd>
              <kbd className="px-1 border border-zinc-700 rounded">O</kbd>
            </span>
          </div>
          {VIEW_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => { setView(o.key); setOpen(false); }}
              className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                view === o.key ? 'text-zinc-100' : 'text-zinc-300'
              }`}
            >
              <span className="flex-1">{o.label}</span>
              {view === o.key && <span className="text-emerald-500" aria-hidden>✓</span>}
            </button>
          ))}
          {/* 字号选择 */}
          <div className="border-t border-zinc-800 mt-1 pt-1 px-3 py-1 flex items-center gap-2">
            {FONT_OPTIONS.map((f, idx) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFont(f.key)}
                className={`px-2 py-0.5 rounded border ${
                  fontSize === f.key
                    ? 'border-emerald-500 text-zinc-100'
                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
                title={`Font ${['Small', 'Medium', 'Large'][idx]}`}
              >
                <span className={f.cls}>{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

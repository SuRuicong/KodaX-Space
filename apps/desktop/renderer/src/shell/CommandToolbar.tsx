// CommandToolbar — F011-revised
//
// 顶部右上 toolbar — 对齐 Claude Desktop 截图 7+8：
//   - 左：Transcript view 按钮 (TranscriptViewMenu)
//   - 右：Activity dropdown，弹出 Preview/Diff/Terminal/Tasks/Plan (+ Agents/MCP Space 扩展)
//
// 之前是 7 个按钮平铺；现在改为单 ▥ 按钮 + dropdown，省顶部空间，更接近截图。

import { useEffect, useRef, useState } from 'react';
import { TranscriptViewMenu } from './TranscriptViewMenu.js';

export type PopoutKind = 'preview' | 'diff' | 'terminal' | 'tasks' | 'plan' | 'agents' | 'mcp';

interface CommandToolbarProps {
  active: PopoutKind | null;
  onToggle: (kind: PopoutKind | null) => void;
}

const POPOUTS: ReadonlyArray<{ kind: PopoutKind; label: string; icon: string; shortcut: string }> = [
  { kind: 'preview', label: 'Preview', icon: '▷', shortcut: '⇧Ctrl P' },
  { kind: 'diff', label: 'Diff', icon: '⫷', shortcut: '⇧Ctrl D' },
  { kind: 'terminal', label: 'Terminal', icon: '>_', shortcut: 'Ctrl `' },
  { kind: 'tasks', label: 'Tasks', icon: '✓', shortcut: '' },
  { kind: 'plan', label: 'Plan', icon: '☰', shortcut: '' },
  { kind: 'agents', label: 'Agents', icon: '⌬', shortcut: '' },
  { kind: 'mcp', label: 'MCP', icon: '⌗', shortcut: '' },
];

export function CommandToolbar({ active, onToggle }: CommandToolbarProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Esc 关闭；点击外部关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
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

  const activeMeta = active ? POPOUTS.find((p) => p.kind === active) : null;

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <TranscriptViewMenu />

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`px-2 py-1 text-[11px] rounded font-mono ${
            open || active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/50'
          }`}
          title="Activity views"
          aria-label="Activity views"
        >
          <span aria-hidden>▥</span>
          {activeMeta && <span className="ml-1 text-[10px]">{activeMeta.label}</span>}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50">
            {POPOUTS.map((p) => (
              <button
                key={p.kind}
                type="button"
                onClick={() => {
                  onToggle(active === p.kind ? null : p.kind);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 ${
                  active === p.kind ? 'text-zinc-100' : 'text-zinc-300'
                }`}
                title={p.shortcut ? `${p.label} (${p.shortcut})` : p.label}
              >
                <span className="w-4 text-zinc-400" aria-hidden>{p.icon}</span>
                <span className="flex-1">{p.label}</span>
                {p.shortcut && (
                  <span className="text-zinc-500 text-[10px] font-mono">{p.shortcut}</span>
                )}
                {active === p.kind && <span className="text-emerald-500" aria-hidden>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

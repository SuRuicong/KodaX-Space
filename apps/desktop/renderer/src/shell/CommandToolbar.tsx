// CommandToolbar — F011-revised / F054 视觉刷新
//
// 顶部右上 toolbar — 对齐 Claude Desktop 截图 7+8：
//   - 左：Transcript view 按钮 (TranscriptViewMenu)
//   - 右：Activity dropdown，弹出 Preview/Diff/Terminal (+ Agents/MCP Space 扩展)
//
// 单 Activity 按钮 + dropdown，省顶部空间。F054：glyph → Lucide 矢量图标 + 语义 token。

import { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid,
  Eye,
  GitCompare,
  Terminal,
  Bot,
  Plug,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { TranscriptViewMenu } from './TranscriptViewMenu.js';

// 'artifact' (F059b) 不进 toolbar 下拉(同 tasks/plan)——由 RightSidebar Artifact section 的 ⤢ 触发。
export type PopoutKind = 'preview' | 'diff' | 'terminal' | 'tasks' | 'plan' | 'agents' | 'mcp' | 'artifact';

interface CommandToolbarProps {
  active: PopoutKind | null;
  onToggle: (kind: PopoutKind | null) => void;
}

// F041 v0.1.4: 移除 'tasks' / 'plan'（避免与 RightSidebar.Workers/Plan section 的 expand 按钮双入口）。
// 触发 PlanPanel / TasksPanel 现在只能从 RightSidebar 标题的 expand 走 requestPopout。
// 保留 PopoutKind 联合的 'tasks' / 'plan' 以兼容 requestPopout 字符串值，但下拉里看不到。
const POPOUTS: ReadonlyArray<{
  kind: PopoutKind;
  label: string;
  Icon: LucideIcon;
  shortcut: string;
}> = [
  { kind: 'preview', label: 'Preview', Icon: Eye, shortcut: '⇧Ctrl P' },
  { kind: 'diff', label: 'Diff', Icon: GitCompare, shortcut: '⇧Ctrl D' },
  { kind: 'terminal', label: 'Terminal', Icon: Terminal, shortcut: 'Ctrl `' },
  { kind: 'agents', label: 'Agents', Icon: Bot, shortcut: '' },
  { kind: 'mcp', label: 'MCP', Icon: Plug, shortcut: '' },
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
          className={`flex items-center gap-1.5 px-2 py-1 text-[12px] rounded-md transition-colors ${
            open || active
              ? 'bg-surface-3 text-fg-primary'
              : 'text-fg-secondary hover:text-fg-primary hover:bg-hover-bg'
          }`}
          title="Activity views"
          aria-label="Activity views"
        >
          <LayoutGrid className="w-4 h-4" strokeWidth={1.75} aria-hidden />
          {activeMeta && <span className="text-xs">{activeMeta.label}</span>}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-[13px] z-50">
            {POPOUTS.map((p) => (
              <button
                key={p.kind}
                type="button"
                onClick={() => {
                  onToggle(active === p.kind ? null : p.kind);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-hover-bg flex items-center gap-2.5 transition-colors ${
                  active === p.kind ? 'text-fg-primary' : 'text-fg-secondary'
                }`}
                title={p.shortcut ? `${p.label} (${p.shortcut})` : p.label}
              >
                <p.Icon className="w-4 h-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">{p.label}</span>
                {p.shortcut && (
                  <span className="text-fg-muted text-[11px] font-mono">{p.shortcut}</span>
                )}
                {active === p.kind && (
                  <Check className="w-3.5 h-3.5 text-accent-ink" strokeWidth={2.5} aria-hidden />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

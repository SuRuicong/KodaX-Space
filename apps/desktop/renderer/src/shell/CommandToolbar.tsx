// CommandToolbar — F011-revised
//
// 顶部右上 toolbar：5 个按需呼出的 popout 按钮 + Transcript view 切换。
//
// 截图参考（Claude Desktop 嵌 Claude Code）：
//   - 左图标：Transcript view (Normal/Thinking/Verbose/Summary + 字号)
//   - 右图标：Activity menu (Preview Ctrl+P / Diff Ctrl+D / Terminal Ctrl+` / Tasks / Plan)
//
// 当前 alpha.1 只做按钮 + popout 切换；具体每个 popout 内部业务在 popouts/ 单独实现。

export type PopoutKind = 'preview' | 'diff' | 'terminal' | 'tasks' | 'plan' | 'agents' | 'mcp';

interface CommandToolbarProps {
  active: PopoutKind | null;
  onToggle: (kind: PopoutKind | null) => void;
}

const POPOUTS: Array<{ kind: PopoutKind; label: string; icon: string; shortcut: string }> = [
  { kind: 'preview', label: 'Preview', icon: '▷', shortcut: 'Ctrl+P' },
  { kind: 'diff', label: 'Diff', icon: '⫷', shortcut: 'Ctrl+D' },
  { kind: 'terminal', label: 'Terminal', icon: '>_', shortcut: 'Ctrl+`' },
  { kind: 'tasks', label: 'Tasks', icon: '✓', shortcut: '' },
  { kind: 'plan', label: 'Plan', icon: '☰', shortcut: '' },
  // FEATURE_034: AGENTS.md popout — 显示当前 session 已加载的 AGENTS.md（global + project）
  { kind: 'agents', label: 'Agents', icon: '⌬', shortcut: '' },
  // FEATURE_036: MCP popout — 列出已配置 MCP server（read-only；start/stop 待 v0.1.7）
  { kind: 'mcp', label: 'MCP', icon: '⌗', shortcut: '' },
];

export function CommandToolbar({ active, onToggle }: CommandToolbarProps): JSX.Element {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {POPOUTS.map((p) => (
        <button
          key={p.kind}
          type="button"
          onClick={() => onToggle(active === p.kind ? null : p.kind)}
          className={`px-2 py-1 text-[11px] rounded font-mono ${
            active === p.kind ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:text-zinc-100'
          }`}
          title={p.shortcut ? `${p.label} (${p.shortcut})` : p.label}
        >
          <span aria-hidden>{p.icon}</span> {p.label}
        </button>
      ))}
    </div>
  );
}

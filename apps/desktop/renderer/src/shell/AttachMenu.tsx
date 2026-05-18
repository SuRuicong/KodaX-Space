// AttachMenu — alpha.1
//
// Claude Desktop 底部输入框旁"+"号按钮 popup（截图 2）：
//
//   📎 Add files or photos
//   📁 Add folder
//   ⌗ Slash commands
//   ⚙ Connectors ›
//   🧩 Plugins ›
//
// alpha.1 范围：
//   - Add files：native picker 选文件 → 把 path 注入到 prompt 末尾作为 inline 引用
//     （后续接 KodaX attachments API 时改为正式 attachment slot）
//   - Slash commands：弹个简单的 list（"/help"、"/clear"、"/mode" 等），点击插入到 prompt
//   - Add folder / Connectors / Plugins：占位 + "Coming"

import { useEffect, useState } from 'react';

interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  onInsertText: (text: string) => void;
}

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear conversation context (new session)' },
  { cmd: '/mode', desc: 'Cycle permission mode' },
  { cmd: '/model', desc: 'Switch model' },
];

export function AttachMenu({ open, onClose, onInsertText }: AttachMenuProps): JSX.Element | null {
  const [showSlash, setShowSlash] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowSlash(false);
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function addFiles(): Promise<void> {
    if (!window.kodaxSpace) return;
    // alpha.1 借用 project.openDialog 来选目录——没有专门的文件 picker IPC。
    // 后续加 files.openDialog channel 支持多选。
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      onInsertText(`@${r.data.path}`);
    }
    onClose();
  }

  if (showSlash) {
    return (
      <div
        className="absolute left-0 bottom-full mb-1 w-72 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 z-50"
        onMouseLeave={onClose}
      >
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-2">
          <button type="button" onClick={() => setShowSlash(false)} className="hover:text-zinc-300">←</button>
          <span>Slash commands</span>
        </div>
        {SLASH_COMMANDS.map((s) => (
          <button
            key={s.cmd}
            type="button"
            onClick={() => {
              onInsertText(s.cmd + ' ');
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center gap-2 text-xs"
          >
            <code className="text-emerald-400 font-mono">{s.cmd}</code>
            <span className="text-zinc-500 truncate">{s.desc}</span>
          </button>
        ))}
        <div className="border-t border-zinc-800 mt-1 pt-1 px-3 py-1 text-[10px] text-zinc-600">
          User-defined slash commands — v0.1.x
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute left-0 bottom-full mb-1 w-56 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
      onMouseLeave={onClose}
    >
      <AttachRow icon="📎" label="Add files or photos" onClick={() => void addFiles()} />
      <AttachRow icon="📁" label="Add folder" disabled hint="v0.1.x" />
      <AttachRow icon="⌗" label="Slash commands" onClick={() => setShowSlash(true)} chevron />
      <AttachRow icon="⚙" label="Connectors" disabled chevron hint="MCP servers — v0.1.1 F013" />
      <AttachRow icon="🧩" label="Plugins" disabled chevron hint="KodaX skills — v0.1.x" />
    </div>
  );
}

function AttachRow({
  icon,
  label,
  onClick,
  disabled,
  chevron,
  hint,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
        disabled ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <span className="w-4" aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      {chevron && <span className="text-zinc-600" aria-hidden>›</span>}
    </button>
  );
}

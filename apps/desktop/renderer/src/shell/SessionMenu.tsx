// SessionMenu — alpha.1
//
// Claude Desktop session 名右侧 ▾ 下拉（截图 1）：
//
//   Open in        ›
//   Pin            P    (alpha.1: 占位)
//   Mark as unread U    (alpha.1: 占位)
//   Rename         R    ✓ 已有
//   Fork           F    (alpha.1: 占位)
//   Move to group  ›    (alpha.1: 灰)
//   Archive        A    (alpha.1: 占位)
//   Delete         D    ✓ 已有
//
// 实装：Rename / Delete（IPC 已有）；其他先占位 + "Coming"。
// 快捷键：在 popover open 时绑定单字母，关闭时不影响输入框。

import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

interface SessionMenuProps {
  sessionId: string;
  onClose: () => void;
}

export function SessionMenu({ sessionId, onClose }: SessionMenuProps): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const removeSession = useAppStore((s) => s.removeSession);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const session = sessions.find((x) => x.sessionId === sessionId);

  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(session?.title ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (renaming) return;
      const key = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        r: () => setRenaming(true),
        d: () => void doDelete(),
        p: () => alert('Pin — coming v0.1.x'),
        u: () => alert('Mark as unread — coming v0.1.x'),
        f: () => alert('Fork — coming v0.1.x'),
        a: () => alert('Archive — coming v0.1.x'),
        escape: () => onClose(),
      };
      const fn = map[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming, sessionId]);

  async function doRename(): Promise<void> {
    const trimmed = newTitle.trim();
    if (!session || !window.kodaxSpace || trimmed === '' || trimmed === session.title) {
      setRenaming(false);
      onClose();
      return;
    }
    const r = await window.kodaxSpace.invoke('session.setTitle', {
      sessionId,
      title: trimmed,
    });
    if (r.ok) {
      upsertSession({ ...session, title: trimmed });
    }
    setRenaming(false);
    onClose();
  }

  async function doDelete(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!confirm(`Delete session "${session?.title ?? sessionId}"? This cannot be undone.`)) {
      return;
    }
    const r = await window.kodaxSpace.invoke('session.delete', { sessionId });
    if (r.ok && r.data.deleted) {
      removeSession(sessionId);
    }
    onClose();
  }

  if (renaming) {
    return (
      <div
        className="absolute left-0 top-full mt-1 w-64 bg-zinc-900 border border-zinc-800 rounded shadow-xl p-2 z-50"
      >
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doRename();
            else if (e.key === 'Escape') {
              setRenaming(false);
              onClose();
            }
          }}
          autoFocus
          className="w-full bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded focus:outline-none focus:border-zinc-700"
          placeholder="New session title"
        />
        <div className="flex gap-1 mt-1 text-[10px]">
          <button
            type="button"
            onClick={() => void doRename()}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              onClose();
            }}
            className="px-2 py-0.5 text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute left-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-50"
      onMouseLeave={onClose}
    >
      <MenuRow icon="↗" label="Open in" shortcut="" disabled hint="External app — v0.1.x" />
      <MenuRow icon="📌" label="Pin" shortcut="P" disabled hint="v0.1.x" />
      <MenuRow icon="●" label="Mark as unread" shortcut="U" disabled hint="v0.1.x" />
      <MenuRow icon="✎" label="Rename" shortcut="R" onClick={() => setRenaming(true)} />
      <MenuRow icon="⑂" label="Fork" shortcut="F" disabled hint="v0.1.x" />
      <MenuRow icon="📂" label="Move to group" shortcut="" disabled hint="v0.1.x" />
      <MenuRow icon="📦" label="Archive" shortcut="A" disabled hint="v0.1.x" />
      <div className="border-t border-zinc-800 my-1" />
      <MenuRow icon="🗑" label="Delete" shortcut="D" onClick={() => void doDelete()} danger />
    </div>
  );
}

interface MenuRowProps {
  icon: string;
  label: string;
  shortcut: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

function MenuRow({ icon, label, shortcut, onClick, disabled, hint, danger }: MenuRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`w-full text-left px-3 py-1 flex items-center gap-2 ${
        disabled
          ? 'text-zinc-700 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-red-950/40'
            : 'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <span className="w-4" aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[10px] text-zinc-600">{shortcut}</span>
    </button>
  );
}

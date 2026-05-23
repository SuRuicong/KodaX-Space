// SessionContextMenu — alpha.1
//
// Claude Desktop 截图 4：右键 session 标题弹出菜单：
//   ┌──────────────────────┐
//   │ Open in            > │
//   │ Pin                P │
//   │ Mark as unread     U │
//   │ Rename             R │
//   │ Fork               F │
//   │ Move to group      > │
//   │ Archive            A │
//   │ Delete             D │   (红色)
//   └──────────────────────┘
//
// Space 实现状态：
//   - Open in     → 占位（Sublime/VSCode/Cursor 一键打开 — v0.1.x）
//   - Pin         → 本地 sessionFlags.pinned (zustand)
//   - Mark unread → 本地 sessionFlags.unread (zustand)
//   - Rename      → 用 prompt() 弹输入框 → session.setTitle
//   - Fork        → session.fork + appStore.forkSessionBuffers (FEATURE_033 现成)
//   - Move group  → 占位（v0.1.x）
//   - Archive     → 本地 sessionFlags.archived (zustand)
//   - Delete      → session.delete + appStore.removeSession (有确认提示)

import { useEffect, useRef } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';

interface SessionContextMenuProps {
  readonly session: SessionMeta;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

export function SessionContextMenu({ session, x, y, onClose }: SessionContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const toggleFlag = useAppStore((s) => s.toggleSessionFlag);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const forkBuffers = useAppStore((s) => s.forkSessionBuffers);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const userMsgs = useAppStore((s) => s.userMessagesBySession[session.sessionId]);

  // 点击菜单外部 / Esc → 关闭
  useEffect(() => {
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
      // 按字母快捷键执行——和截图对齐 (P/U/R/F/A/D)
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'pinned');
        onClose();
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'unread');
        onClose();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void onRename();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void onFork();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleFlag(session.sessionId, 'archived');
        onClose();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        void onDelete();
      }
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  async function onRename(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    const next = window.prompt('New session title:', session.title ?? '');
    if (next === null) return;
    const trimmed = next.trim().slice(0, 256);
    if (trimmed === '') return;
    const r = await window.kodaxSpace.invoke('session.setTitle', {
      sessionId: session.sessionId,
      title: trimmed,
    });
    if (r.ok) upsertSession({ ...session, title: trimmed });
  }

  async function onFork(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    // Fork 在最后一个 user message 处 (turn idx = msgs.length - 1)；
    // 没有 user message 时 idx = 0（直接 fork "空对话"）
    const turnIdx = Math.max(0, (userMsgs?.length ?? 0) - 1);
    const r = await window.kodaxSpace.invoke('session.fork', {
      sessionId: session.sessionId,
      forkPointTurnIdx: turnIdx,
    });
    if (!r.ok) return;
    // 复制 buffer + 建 stub session meta，刷新 list 让 SDK 权威值覆盖
    const stub: SessionMeta = {
      ...session,
      sessionId: r.data.newSessionId,
      parentSessionId: session.sessionId,
      forkPointTurnIdx: turnIdx,
      title: session.title ? `${session.title} (fork)` : 'Forked session',
      createdAt: r.data.createdAt,
      lastActivityAt: r.data.createdAt,
    };
    upsertSession(stub);
    forkBuffers(session.sessionId, r.data.newSessionId, turnIdx);
    setCurrentSession(r.data.newSessionId);
    const listR = await window.kodaxSpace.invoke('session.list', {
      projectRoot: session.projectRoot,
    });
    if (listR.ok) useAppStore.getState().setSessions(listR.data.sessions);
  }

  async function onDelete(): Promise<void> {
    onClose();
    if (!window.kodaxSpace) return;
    const confirmed = window.confirm(
      `Delete session "${session.title ?? session.sessionId.slice(0, 8)}"? This can't be undone.`,
    );
    if (!confirmed) return;
    const r = await window.kodaxSpace.invoke('session.delete', { sessionId: session.sessionId });
    if (r.ok && r.data.deleted) removeSession(session.sessionId);
  }

  // 屏幕边界保护：菜单宽度 192px / 高度估算约 240px；超出右/下视口时翻转
  const VIEWPORT_W = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const VIEWPORT_H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const MENU_W = 192;
  const MENU_H = 256;
  const left = Math.min(x, VIEWPORT_W - MENU_W - 8);
  const top = Math.min(y, VIEWPORT_H - MENU_H - 8);

  return (
    <div
      ref={ref}
      className="fixed bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 text-xs z-[100] min-w-[12rem]"
      style={{ left, top }}
      role="menu"
    >
      <MenuRow label="Open in" hint="" disabled chevron tip="v0.1.x" />
      <Divider />
      <MenuRow label="Pin" hint="P" onClick={() => { toggleFlag(session.sessionId, 'pinned'); onClose(); }} />
      <MenuRow label="Mark as unread" hint="U" onClick={() => { toggleFlag(session.sessionId, 'unread'); onClose(); }} />
      <MenuRow label="Rename" hint="R" onClick={() => void onRename()} />
      <MenuRow label="Fork" hint="F" onClick={() => void onFork()} />
      <MenuRow label="Move to group" hint="" disabled chevron tip="v0.1.x" />
      <MenuRow label="Archive" hint="A" onClick={() => { toggleFlag(session.sessionId, 'archived'); onClose(); }} />
      <Divider />
      <MenuRow label="Delete" hint="D" onClick={() => void onDelete()} danger />
    </div>
  );
}

function MenuRow({
  label,
  hint,
  onClick,
  disabled,
  chevron,
  danger,
  tip,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  danger?: boolean;
  tip?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tip}
      role="menuitem"
      className={`w-full text-left px-3 py-1 flex items-center gap-2 ${
        disabled
          ? 'text-zinc-600 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-zinc-800'
            : 'text-zinc-200 hover:bg-zinc-800'
      }`}
    >
      <span className="flex-1">{label}</span>
      {chevron && <span className="text-zinc-500" aria-hidden>›</span>}
      {hint && <span className="text-zinc-500 text-[10px] font-mono">{hint}</span>}
    </button>
  );
}

function Divider(): JSX.Element {
  return <div className="border-t border-zinc-800 my-1" />;
}

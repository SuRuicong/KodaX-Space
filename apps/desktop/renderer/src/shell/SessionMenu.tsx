// SessionMenu — alpha.1
//
// Claude Desktop session 名右侧 ▾ 下拉（截图 1）：
//
//   Open in        ›
//   Pin            P    (alpha.1: 占位)
//   Mark as unread U    (alpha.1: 占位)
//   Rename         R    ✓ 已有
//   Fork           F    ✓ FEATURE_033 (in-memory)
//   Rewind         W    ✓ FEATURE_033 (in-memory)
//   Move to group  ›    (alpha.1: 灰)
//   Archive        A    (alpha.1: 占位)
//   Delete         D    ✓ 已有
//
// 实装：Rename / Fork / Rewind / Delete。Fork/Rewind alpha.1 仅 in-memory（重启 desktop
// 会丢）；KodaX SDK 0.7.42 出 forkSession()/rewindSession() 后接磁盘。

import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Pin,
  PinOff,
  Circle,
  Pencil,
  GitFork,
  Undo2,
  Network,
  FolderInput,
  Archive,
  ArchiveRestore,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore, type UserMessage } from '../store/appStore.js';
import { SessionLineagePanel } from '../features/session/SessionLineagePanel.js';

// 稳定空数组，防 selector `?? []` literal 每次新引用触发 zustand re-render loop (React #185)。
const EMPTY_USER_MESSAGES: readonly UserMessage[] = [];

interface SessionMenuProps {
  sessionId: string;
  onClose: () => void;
}

export function SessionMenu({ sessionId, onClose }: SessionMenuProps): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const removeSession = useAppStore((s) => s.removeSession);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const forkSessionBuffers = useAppStore((s) => s.forkSessionBuffers);
  const rewindSessionBuffers = useAppStore((s) => s.rewindSessionBuffers);
  const userMessages = useAppStore(
    (s) => s.userMessagesBySession[sessionId] ?? EMPTY_USER_MESSAGES,
  );
  const sessionFlags = useAppStore((s) => s.sessionFlags[sessionId]);
  const toggleFlag = useAppStore((s) => s.toggleSessionFlag);
  const session = sessions.find((x) => x.sessionId === sessionId);

  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(session?.title ?? '');
  const [showLineage, setShowLineage] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (renaming) return;
      const key = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        r: () => setRenaming(true),
        d: () => void doDelete(),
        f: () => void doFork(),
        w: () => void doRewind(),
        l: () => setShowLineage((v) => !v),
        p: () => {
          toggleFlag(sessionId, 'pinned');
          onClose();
        },
        u: () => {
          toggleFlag(sessionId, 'unread');
          onClose();
        },
        a: () => {
          toggleFlag(sessionId, 'archived');
          onClose();
        },
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
  }, [renaming, sessionId, userMessages.length]);

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

  /**
   * FEATURE_033 Fork: 从当前对话末尾 fork 出一条新 session。
   * alpha.1 in-memory：events 全量复制到新 session id；重启 desktop 会丢。
   * forkPointTurnIdx 取 userMessages.length - 1（即"到最后一条 user message 为止"）；
   * 空对话 fork (没发过任何 prompt) 用 0。
   */
  async function doFork(): Promise<void> {
    if (!window.kodaxSpace || !session) return;
    const forkPointTurnIdx = Math.max(0, userMessages.length - 1);
    const r = await window.kodaxSpace.invoke('session.fork', {
      sessionId,
      forkPointTurnIdx,
    });
    if (!r.ok) {
      alert(`Fork failed: ${r.error?.message ?? 'unknown error'}`);
      onClose();
      return;
    }
    const { newSessionId, createdAt } = r.data;
    // 推一条新 meta 到 sessions list；ports parent metadata 从 main 来（这里手工 mirror，
    // 避免再发一次 session.list；下次 sidebar 刷新会按 main 数据矫正）。
    // title 与 main 端 stripForkSuffix 保持一致——连 fork N 次仍是 "X (fork)"。
    const childTitle =
      session.title !== undefined
        ? `${session.title.replace(/( \(fork\))+$/, '')} (fork)`
        : undefined;
    upsertSession({
      sessionId: newSessionId,
      projectRoot: session.projectRoot,
      provider: session.provider,
      reasoningMode: session.reasoningMode,
      permissionMode: session.permissionMode,
      autoModeEngine: session.autoModeEngine,
      agentMode: session.agentMode, // fork 继承 source 的形态
      title: childTitle,
      createdAt,
      lastActivityAt: createdAt,
      parentSessionId: sessionId,
      forkPointTurnIdx,
    });
    // 复制 buffer 到新 session
    forkSessionBuffers(sessionId, newSessionId, forkPointTurnIdx);
    // 切到新 session（用户期望"fork 后立刻在新分支里干活"）
    setCurrentSession(newSessionId);
    onClose();
  }

  /**
   * FEATURE_033 Rewind: 把当前 session 回退一个 turn（去掉最后一条 user message + 其后所有 events）。
   * 没有可回退的 turn (userMessages.length === 0) → no-op。
   */
  async function doRewind(): Promise<void> {
    if (!window.kodaxSpace || !session) return;
    if (userMessages.length === 0) {
      alert('Nothing to rewind — no turns yet.');
      onClose();
      return;
    }
    if (!confirm(`Rewind 1 turn? The last response will be discarded.`)) {
      onClose();
      return;
    }
    // rewindPastTurnIdx = 保留前 N 条 user messages；要丢最后一条意味着保留 (length - 2) 索引位。
    // 当 length === 1 时 (-1) 即 "啥都不留"——main 端 schema 要求 idx >= 0，所以传 0；
    // renderer 端 1-turn-only 走 reset 全部分支（resetSessionMessages 当 length===1 时等价）。
    const onlyOneTurn = userMessages.length === 1;
    const rewindPastTurnIdx = onlyOneTurn ? 0 : userMessages.length - 2;
    const r = await window.kodaxSpace.invoke('session.rewind', { sessionId, rewindPastTurnIdx });
    if (!r.ok) {
      alert(`Rewind failed: ${r.error?.message ?? 'unknown error'}`);
      onClose();
      return;
    }
    if (!r.data.ok) {
      alert(`Rewind rejected: ${r.data.reason ?? 'unknown'}`);
      onClose();
      return;
    }
    // IPC ok → 才动 local state（reviewer F033 MEDIUM-4: 失败时不要优化更新本地）
    if (onlyOneTurn) {
      useAppStore.getState().resetSessionMessages(sessionId);
    } else {
      rewindSessionBuffers(sessionId, rewindPastTurnIdx);
    }
    onClose();
  }

  if (renaming) {
    return (
      <div className="absolute left-0 top-full mt-1 w-64 bg-surface-4 border border-border-default rounded-lg shadow-xl p-2 z-50">
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
          className="w-full bg-surface border border-border-default text-xs text-fg-primary px-2 py-1 rounded focus:outline-none focus:border-border-strong"
          placeholder="New session title"
        />
        <div className="flex gap-1 mt-1 text-[11px]">
          <button
            type="button"
            onClick={() => void doRename()}
            className="px-2 py-0.5 rounded bg-surface-3 hover:bg-hover-bg text-fg-primary"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              onClose();
            }}
            className="px-2 py-0.5 text-fg-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`absolute left-0 top-full mt-1 ${showLineage ? 'w-80' : 'w-52'} bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50`}
      onMouseLeave={onClose}
    >
      <MenuRow
        Icon={ExternalLink}
        label="Open in"
        shortcut=""
        disabled
        hint="External app — v0.1.x"
      />
      <MenuRow
        Icon={sessionFlags?.pinned ? PinOff : Pin}
        label={sessionFlags?.pinned ? 'Unpin' : 'Pin'}
        shortcut="P"
        onClick={() => {
          toggleFlag(sessionId, 'pinned');
          onClose();
        }}
      />
      <MenuRow
        Icon={Circle}
        label={sessionFlags?.unread ? 'Mark as read' : 'Mark as unread'}
        shortcut="U"
        onClick={() => {
          toggleFlag(sessionId, 'unread');
          onClose();
        }}
      />
      <MenuRow Icon={Pencil} label="Rename" shortcut="R" onClick={() => setRenaming(true)} />
      <MenuRow Icon={GitFork} label="Fork" shortcut="F" onClick={() => void doFork()} />
      <MenuRow
        Icon={Undo2}
        label="Rewind 1 turn"
        shortcut="W"
        onClick={() => void doRewind()}
        disabled={userMessages.length === 0}
        hint={userMessages.length === 0 ? 'No turns yet' : undefined}
      />
      <MenuRow
        Icon={Network}
        label={showLineage ? 'Hide lineage' : 'Show lineage'}
        shortcut="L"
        onClick={() => setShowLineage((v) => !v)}
      />
      {showLineage && (
        <div className="border-t border-border-default mt-1 pt-1">
          <SessionLineagePanel
            anchorSessionId={sessionId}
            onPickSession={(sid) => {
              setCurrentSession(sid);
              onClose();
            }}
          />
        </div>
      )}
      <MenuRow Icon={FolderInput} label="Move to group" shortcut="" disabled hint="v0.1.x" />
      <MenuRow
        Icon={sessionFlags?.archived ? ArchiveRestore : Archive}
        label={sessionFlags?.archived ? 'Unarchive' : 'Archive'}
        shortcut="A"
        onClick={() => {
          toggleFlag(sessionId, 'archived');
          onClose();
        }}
      />
      <div className="border-t border-border-default my-1" />
      <MenuRow Icon={Trash2} label="Delete" shortcut="D" onClick={() => void doDelete()} danger />
    </div>
  );
}

interface MenuRowProps {
  Icon: LucideIcon;
  label: string;
  shortcut: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

function MenuRow({
  Icon,
  label,
  shortcut,
  onClick,
  disabled,
  hint,
  danger,
}: MenuRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`w-full text-left px-3 py-1 flex items-center gap-2 ${
        disabled
          ? 'text-fg-faint cursor-not-allowed'
          : danger
            ? 'text-danger hover:bg-danger/15'
            : 'text-fg-secondary hover:bg-hover-bg'
      }`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="text-[11px] text-fg-faint">{shortcut}</span>
    </button>
  );
}

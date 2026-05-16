// SessionList — 左抽屉下半。当前项目下的 sessions + "New session" 按钮。
//
// 数据流：
//   - currentProjectPath 变化 → invoke session.list { projectRoot } → setSessions
//   - 点 "New session" → invoke session.create → upsertSession + setCurrentSession
//   - 点 session 卡片 → setCurrentSession（仅切视图，无 IPC）
//   - 右键卡片 → 弹 Rename / Delete

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

const PROVIDERS = ['mock', 'anthropic', 'openai', 'zhipu-coding'] as const;
type Provider = (typeof PROVIDERS)[number];

export function SessionList(): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setSessions = useAppStore((s) => s.setSessions);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const [creating, setCreating] = useState<boolean>(false);
  const [provider, setProvider] = useState<Provider>('mock');

  useEffect(() => {
    if (!currentProjectPath) {
      setSessions([]);
      return;
    }
    void refreshSessions(currentProjectPath, setSessions);
  }, [currentProjectPath, setSessions]);

  async function handleCreate(): Promise<void> {
    if (!currentProjectPath) return;
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    setCreating(true);
    try {
      const result = await bridge.invoke('session.create', {
        projectRoot: currentProjectPath,
        provider,
        reasoningMode: 'auto',
      });
      if (!result.ok) {
        console.error('[SessionList] create failed:', result.error);
        return;
      }
      // host 那边没有保存完整 SessionMeta；renderer 自己构造一个 stub，
      // 然后立刻 session.list 刷新拿权威值。
      const stub: SessionMeta = {
        sessionId: result.data.sessionId,
        projectRoot: currentProjectPath,
        provider,
        reasoningMode: 'auto',
        title: undefined,
        createdAt: result.data.createdAt,
        lastActivityAt: result.data.createdAt,
      };
      upsertSession(stub);
      setCurrentSession(stub.sessionId);
      void refreshSessions(currentProjectPath, setSessions);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, sessionId: string): Promise<void> {
    e.stopPropagation();
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const result = await bridge.invoke('session.delete', { sessionId });
    if (result.ok && result.data.deleted) {
      removeSession(sessionId);
    }
  }

  async function handleRename(e: React.MouseEvent, sessionId: string, current: string | undefined): Promise<void> {
    e.stopPropagation();
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const next = window.prompt('Rename session:', current ?? '');
    if (next === null || next.trim() === '') return;
    const result = await bridge.invoke('session.setTitle', { sessionId, title: next.trim() });
    if (result.ok && currentProjectPath) {
      void refreshSessions(currentProjectPath, setSessions);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Sessions</h2>
        <div className="flex items-center gap-1">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1 py-0.5"
            disabled={!currentProjectPath}
            title="Provider for new sessions"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!currentProjectPath || creating}
            className="text-xs px-2 py-1 rounded bg-emerald-700/80 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            title={currentProjectPath ? 'Create new session' : 'Pick a project first'}
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0">
        {!currentProjectPath && (
          <div className="text-xs text-zinc-600 italic px-1">Pick a project above to see its sessions.</div>
        )}
        {currentProjectPath && sessions.length === 0 && (
          <div className="text-xs text-zinc-600 italic px-1">
            No sessions yet. Click + to create one.
          </div>
        )}
        {sessions.map((s) => {
          const isActive = s.sessionId === currentSessionId;
          return (
            <div
              key={s.sessionId}
              role="button"
              tabIndex={0}
              onClick={() => setCurrentSession(s.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCurrentSession(s.sessionId);
                }
              }}
              className={`group cursor-pointer text-left px-2 py-2 rounded text-sm flex flex-col gap-0.5 ${
                isActive
                  ? 'bg-blue-900/30 border border-blue-800/50 text-blue-100'
                  : 'hover:bg-zinc-800 text-zinc-300 border border-transparent'
              }`}
              title={s.sessionId}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{s.title ?? 'Untitled session'}</span>
                <span className="opacity-0 group-hover:opacity-100 flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={(e) => void handleRename(e, s.sessionId, s.title)}
                    className="text-zinc-500 hover:text-zinc-200 px-1"
                    aria-label="Rename session"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(e, s.sessionId)}
                    className="text-zinc-500 hover:text-red-400 px-1"
                    aria-label="Delete session"
                  >
                    ×
                  </button>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                <span>{s.provider}</span>
                <span>·</span>
                <span>{s.reasoningMode}</span>
                <span>·</span>
                <span>{formatRelativeTime(s.lastActivityAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function refreshSessions(
  projectRoot: string,
  setSessions: (s: readonly SessionMeta[]) => void,
): Promise<void> {
  const bridge = window.kodaxSpace;
  if (!bridge) return;
  const result = await bridge.invoke('session.list', { projectRoot });
  if (result.ok) {
    setSessions(result.data.sessions);
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

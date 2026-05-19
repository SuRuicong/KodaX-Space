// LeftSidebar — F011-revised + FEATURE_033 tree view
//
// Claude Desktop 风左侧侧栏：
//   ┌─────────────┐
//   │ [Coder][Partner]  ← mode tab (Partner 灰 + "Coming")
//   │
//   │ + New session
//   │ ⏰ Scheduled  (灰，v0.1.x)
//   │ 💼 Customize  (灰，v0.1.x)
//   │ ▾ More
//   │
//   │ Recents ────────────────
//   │   · 项目分析
//   │     ⑂ 项目分析 (fork)         ← FEATURE_033 fork child 缩进显示
//   │   · 修个 bug
//   └─────────────┘
//
// ADR-004 v2 决策：M0 就显示 Coder/Partner tab；Partner 灰 + "Coming"。

import { useEffect, useMemo } from 'react';
import type { Mode } from './Shell.js';
import { useAppStore } from '../store/appStore.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

interface LeftSidebarProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
}

export function LeftSidebar({ mode, onModeChange }: LeftSidebarProps): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);

  // 启动期拉一次 session list（暂时这里做，后续 Shell 顶层 useEffect 统一管理）
  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !currentProjectPath) return;
    void bridge.invoke('session.list', { projectRoot: currentProjectPath }).then((r) => {
      if (r.ok) useAppStore.getState().setSessions(r.data.sessions);
    });
  }, [currentProjectPath]);

  return (
    <aside className="w-60 flex flex-col border-r border-zinc-900 bg-zinc-950 flex-shrink-0">
      {/* Mode tab */}
      <div className="p-2 flex gap-1 border-b border-zinc-900 flex-shrink-0">
        <button
          type="button"
          onClick={() => onModeChange('coder')}
          className={`flex-1 text-xs py-1.5 rounded ${
            mode === 'coder' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span aria-hidden>≡</span> Coder
        </button>
        <button
          type="button"
          disabled
          className="flex-1 text-xs py-1.5 rounded text-zinc-700 cursor-not-allowed relative"
          title="Partner — Coming in v0.1.x"
        >
          <span aria-hidden>◐</span> Partner
          <span className="absolute -top-0.5 -right-0.5 text-[8px] text-amber-700">soon</span>
        </button>
      </div>

      {/* New session + menus */}
      <div className="p-2 space-y-0.5">
        <button
          type="button"
          onClick={() => setCurrentSession(null)}
          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-zinc-900 text-zinc-300 flex items-center gap-2"
        >
          <span aria-hidden>＋</span> New session
        </button>
        <DisabledMenuItem icon="⏰" label="Scheduled" hint="v0.1.x" />
        <DisabledMenuItem icon="💼" label="Customize" hint="v0.1.x" />
        <DisabledMenuItem icon="▾" label="More" hint="" />
      </div>

      {/* Recents */}
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 flex justify-between flex-shrink-0">
        <span>Recents</span>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {sessions.length === 0 && (
          <div className="text-xs text-zinc-600 px-2 py-3">
            {currentProjectPath ? 'No sessions yet.' : 'Open a folder to start.'}
          </div>
        )}
        <SessionTree
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={setCurrentSession}
        />
      </div>

      {/* Bottom: mode/gateway label */}
      <div className="border-t border-zinc-900 px-3 py-2 text-[10px] text-zinc-600 flex justify-between flex-shrink-0">
        <span className="truncate">KodaX Space · Gateway</span>
        <button type="button" className="hover:text-zinc-400" aria-label="Settings">⚙</button>
      </div>
    </aside>
  );
}

/**
 * FEATURE_033: 按 parentSessionId 把 sessions 排成 root → children 树。
 * 渲染顺序：每个 root 紧跟其 descendants（DFS pre-order）；fork child 缩进 + 用 ⑂ 图标。
 *
 * 边界处理：
 *   - parent 已被 delete 了 → orphan：当 root 渲染（仍能选中、不丢）
 *   - cycle 防御：DFS 走过的 id 不再重复进入
 */
interface SessionTreeProps {
  readonly sessions: readonly SessionMeta[];
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
}

function SessionTree({ sessions, currentSessionId, onSelect }: SessionTreeProps): JSX.Element {
  const rendered = useMemo(() => buildSessionTreeOrder(sessions), [sessions]);
  return (
    <>
      {rendered.map(({ session, depth }) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          depth={depth}
          isSelected={session.sessionId === currentSessionId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

interface SessionTreeNode {
  readonly session: SessionMeta;
  readonly depth: number;
}

/** DFS pre-order，root 按 lastActivityAt 倒序；children 同样倒序。 */
export function buildSessionTreeOrder(sessions: readonly SessionMeta[]): readonly SessionTreeNode[] {
  const byId = new Map<string, SessionMeta>(sessions.map((s) => [s.sessionId, s]));
  const childrenByParent = new Map<string, SessionMeta[]>();
  const roots: SessionMeta[] = [];
  for (const s of sessions) {
    if (s.parentSessionId !== undefined && byId.has(s.parentSessionId)) {
      const bucket = childrenByParent.get(s.parentSessionId) ?? [];
      bucket.push(s);
      childrenByParent.set(s.parentSessionId, bucket);
    } else {
      roots.push(s);
    }
  }
  // 按 lastActivityAt 倒序
  const byActivityDesc = (a: SessionMeta, b: SessionMeta): number => b.lastActivityAt - a.lastActivityAt;
  roots.sort(byActivityDesc);
  for (const list of childrenByParent.values()) list.sort(byActivityDesc);

  const out: SessionTreeNode[] = [];
  const visited = new Set<string>();
  function walk(s: SessionMeta, depth: number): void {
    if (visited.has(s.sessionId)) return; // cycle guard
    visited.add(s.sessionId);
    out.push({ session: s, depth });
    const kids = childrenByParent.get(s.sessionId) ?? [];
    for (const c of kids) walk(c, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return out;
}

function SessionRow({
  session,
  depth,
  isSelected,
  onSelect,
}: {
  session: SessionMeta;
  depth: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const indent = Math.min(depth, 4); // 不无限缩进；4 层就够
  const isFork = depth > 0 || session.parentSessionId !== undefined;
  return (
    <button
      type="button"
      onClick={() => onSelect(session.sessionId)}
      className={`w-full text-left text-xs px-2 py-1 rounded truncate ${
        isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
      }`}
      style={{ paddingLeft: `${0.5 + indent * 0.8}rem` }}
      title={session.title ?? session.sessionId}
    >
      <span className="text-zinc-600 mr-1" aria-hidden>{isFork ? '⑂' : '·'}</span>
      {session.title ?? 'Untitled session'}
    </button>
  );
}

function DisabledMenuItem({ icon, label, hint }: { icon: string; label: string; hint: string }): JSX.Element {
  return (
    <div
      className="w-full text-xs px-2 py-1.5 rounded text-zinc-600 cursor-not-allowed flex items-center gap-2"
      title={hint ? `${label} — ${hint}` : label}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
      {hint && <span className="ml-auto text-[9px] text-zinc-700">{hint}</span>}
    </div>
  );
}

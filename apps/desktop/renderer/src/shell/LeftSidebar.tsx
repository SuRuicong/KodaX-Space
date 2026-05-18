// LeftSidebar — F011-revised
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
//   │   · 修个 bug
//   └─────────────┘
//
// ADR-004 v2 决策：M0 就显示 Coder/Partner tab；Partner 灰 + "Coming"。

import { useEffect } from 'react';
import type { Mode } from './Shell.js';
import { useAppStore } from '../store/appStore.js';

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
        {sessions.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            onClick={() => setCurrentSession(s.sessionId)}
            className={`w-full text-left text-xs px-2 py-1 rounded truncate ${
              s.sessionId === currentSessionId
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-900'
            }`}
            title={s.title ?? s.sessionId}
          >
            <span className="text-zinc-600 mr-1" aria-hidden>·</span>
            {s.title ?? 'Untitled session'}
          </button>
        ))}
      </div>

      {/* Bottom: mode/gateway label */}
      <div className="border-t border-zinc-900 px-3 py-2 text-[10px] text-zinc-600 flex justify-between flex-shrink-0">
        <span className="truncate">KodaX Space · Gateway</span>
        <button type="button" className="hover:text-zinc-400" aria-label="Settings">⚙</button>
      </div>
    </aside>
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

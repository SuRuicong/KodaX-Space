// Breadcrumb — F011-revised
//
// 顶部面包屑：`Project / Session ▾`
// 点 session name 弹下拉切换；点 project name 触发 project picker。

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { SessionMenu } from './SessionMenu.js';

export function Breadcrumb(): JSX.Element {
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const session = sessions.find((x) => x.sessionId === currentSessionId);
  const [menuOpen, setMenuOpen] = useState(false);

  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  async function pickProject(): Promise<void> {
    if (!window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (result.ok && result.data.path !== null) {
      useAppStore.getState().setCurrentProject(result.data.path);
      await window.kodaxSpace.invoke('project.recent.add', { path: result.data.path });
    }
  }

  return (
    <div className="flex items-center gap-1 text-sm text-fg-secondary flex-1 min-w-0">
      {projectName ? (
        <button
          type="button"
          onClick={() => void pickProject()}
          className="px-1.5 py-0.5 rounded hover:bg-hover-bg truncate"
          title={projectPath ?? ''}
        >
          {projectName}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void pickProject()}
          className="px-1.5 py-0.5 rounded hover:bg-hover-bg text-fg-muted"
        >
          Open folder…
        </button>
      )}
      <span className="text-fg-muted">/</span>
      <div className="relative flex items-center min-w-0">
        <span className="px-1.5 py-0.5 truncate text-fg-muted" title={session?.sessionId}>
          {session?.title ?? (session ? 'Untitled session' : 'New session')}
        </span>
        {session && (
          <>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="px-1 py-0.5 text-fg-muted hover:text-fg-secondary text-xs"
              aria-label="Session options"
            >
              ▾
            </button>
            {menuOpen && (
              <SessionMenu sessionId={session.sessionId} onClose={() => setMenuOpen(false)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

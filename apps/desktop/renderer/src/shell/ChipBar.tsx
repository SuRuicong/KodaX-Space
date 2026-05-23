// ChipBar — F011-revised (alpha.1)
//
// 输入框上方 working-context 行：
//   📍 Local · 📁 KodaX-Space · 🌿 main · ☑ worktree
//
// 每个 chip 可点开 dropdown — 对齐 Claude Code New session 三张截图：
//   - Local chip → Local ✓ + ⚙ (打开 Settings popover 改默认 workspace)
//   - Project chip → Recent + Open folder...
//   - Branch chip → branches list (alpha.1 占位, v0.1.x 接 git)

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { SettingsPopover } from './SettingsPopover.js';

export function ChipBar(): JSX.Element | null {
  const projectPath = useAppStore((s) => s.currentProjectPath);

  if (!projectPath) return null;
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
      <LocalChip />
      <ProjectChip projectName={projectName} projectPath={projectPath} />
      <BranchChip />
    </div>
  );
}

/** Local chip — 当前 Local execution + ⚙ 改默认 workspace。 */
function LocalChip(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800"
        title="Execution location"
      >
        <span aria-hidden>📍</span>
        <span>Local</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-48 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 z-50">
          <div className="px-3 py-1.5 hover:bg-zinc-800 flex items-center gap-2 text-xs text-zinc-200">
            <span>Local</span>
            <span className="text-emerald-500 ml-auto" aria-hidden>✓</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen(true); setOpen(false); }}
              className="text-zinc-400 hover:text-zinc-200 ml-1"
              title="Settings — change default workspace"
              aria-label="Open settings"
            >
              ⚙
            </button>
          </div>
        </div>
      )}
      {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Project chip — Recent + Open folder. 截图 2 同款。 */
function ProjectChip({ projectName, projectPath }: { projectName: string; projectPath: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const projects = useAppStore((s) => s.projects);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function pickPath(path: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setCurrentProject(path);
    await window.kodaxSpace.invoke('project.recent.add', { path });
    const listR = await window.kodaxSpace.invoke('project.list', undefined);
    if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
    setOpen(false);
  }

  async function openDialog(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      await pickPath(r.data.path);
    } else {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 max-w-[200px]"
        title={projectPath}
      >
        <span aria-hidden>📁</span>
        <span className="truncate">{projectName}</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-56 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 z-50">
          <div className="px-3 py-1 text-zinc-500 text-[10px] uppercase tracking-wider">Recent</div>
          {projects.length === 0 ? (
            <div className="px-3 py-1 text-[10px] text-zinc-500">No recent projects yet.</div>
          ) : (
            projects.slice(0, 8).map((p) => {
              const isCurrent = p.path === projectPath;
              return (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => void pickPath(p.path)}
                  className={`w-full text-left px-3 py-1 hover:bg-zinc-800 flex items-center gap-2 text-xs ${
                    isCurrent ? 'text-zinc-100' : 'text-zinc-300'
                  }`}
                  title={p.path}
                >
                  <span className="truncate flex-1">{p.name}</span>
                  {isCurrent && <span className="text-emerald-500" aria-hidden>✓</span>}
                </button>
              );
            })
          )}
          <div className="border-t border-zinc-800 my-1" />
          <button
            type="button"
            onClick={() => void openDialog()}
            className="w-full text-left px-3 py-1 hover:bg-zinc-800 text-xs text-zinc-200"
          >
            Open folder…
          </button>
        </div>
      )}
    </div>
  );
}

/** Branch chip — alpha.1 占位；v0.1.x 接 git。 */
function BranchChip(): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800"
      title="Branch detection — v0.1.x (git branches dropdown)"
    >
      <span aria-hidden>🌿</span>
      <span className="truncate max-w-[120px]">main</span>
    </span>
  );
}

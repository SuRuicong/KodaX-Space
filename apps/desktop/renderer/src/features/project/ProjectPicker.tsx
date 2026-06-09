// ProjectPicker — 左抽屉上半。Recent list + "Open folder…" 按钮。
//
// 数据流：
//   - mount 时 invoke project.list → setProjects
//   - 点 "Open folder" → invoke project.openDialog（main 弹 OS picker）→
//     invoke project.recent.add → upsert 到 store + 设为 current
//   - 点 recent 项 → invoke project.recent.add（bump lastUsedAt）+ 设为 current
//   - hover 出现 "×" 按钮 → invoke project.recent.remove

import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';

export function ProjectPicker(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
  const currentPath = useAppStore((s) => s.currentProjectPath);
  const setProjects = useAppStore((s) => s.setProjects);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const resetSessionView = useAppStore((s) => s.resetSessionView);

  useEffect(() => {
    void refreshProjects(setProjects);
  }, [setProjects]);

  async function selectProject(path: string): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    resetSessionView();
    setCurrentProject(path);
    // bump lastUsedAt 并刷新顺序
    const result = await bridge.invoke('project.recent.add', { path });
    if (result.ok) {
      await refreshProjects(setProjects);
    }
  }

  async function handleOpenDialog(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const dialogResult = await bridge.invoke('project.openDialog', undefined);
    if (!dialogResult.ok || dialogResult.data.path === null) return;
    await selectProject(dialogResult.data.path);
  }

  async function handleRemove(e: React.MouseEvent, path: string): Promise<void> {
    e.stopPropagation();
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    await bridge.invoke('project.recent.remove', { path });
    if (currentPath === path) {
      setCurrentProject(null);
      resetSessionView();
    }
    await refreshProjects(setProjects);
  }

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-border-default">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Projects</h2>
        <button
          type="button"
          onClick={handleOpenDialog}
          className="text-xs px-2 py-1 rounded bg-surface-3 hover:bg-hover-bg text-fg-primary"
        >
          Open…
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {projects.length === 0 && (
          <div className="text-xs text-fg-faint italic px-1">
            No recent projects. Click "Open…" to start.
          </div>
        )}
        {projects.map((p) => {
          const isActive = p.path === currentPath;
          return (
            <button
              key={p.path}
              type="button"
              onClick={() => void selectProject(p.path)}
              className={`group text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
                isActive
                  ? 'bg-ok/15 border border-ok/50 text-ok'
                  : 'hover:bg-hover-bg text-fg-secondary'
              }`}
              title={p.path}
            >
              <span className="flex-1 truncate">{p.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => void handleRemove(e, p.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleRemove(e as unknown as React.MouseEvent, p.path);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-danger px-1 cursor-pointer"
                aria-label={`Remove ${p.name} from recent`}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function refreshProjects(
  setProjects: (p: readonly import('@kodax-space/space-ipc-schema').Project[]) => void,
): Promise<void> {
  const bridge = window.kodaxSpace;
  if (!bridge) return;
  const result = await bridge.invoke('project.list', undefined);
  if (result.ok) {
    setProjects(result.data.projects);
  }
}

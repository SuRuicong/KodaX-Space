// ProjectContextMenu — F043 (codex 形态对齐)
//
// 右键项目节点弹出：
//   ┌────────────────────────────┐
//   │ Rename                  R  │
//   │ Archive (or Unarchive)  A  │
//   │ Remove from Space       D  │  (红色 — 不删文件夹，只从 recent 列表移除)
//   └────────────────────────────┘
//
// 设计取舍：
//   - Rename 不在菜单内输入；点 Rename → onClose + 通知父层进入 inline edit 模式
//     （window.prompt 在 Electron 上不稳定，跟 SessionContextMenu 一致处理）
//   - Remove 走 confirm() 二次确认：避免误点直接丢失项目历史
//   - Archive / Unarchive 切 toggle，立即生效，无需确认（用户随时再 toggle 回来）

import { useCallback, useEffect, useRef } from 'react';
import type { Project } from '@kodax-space/space-ipc-schema';
import { pushToast } from '../store/toastStore.js';

interface ProjectContextMenuProps {
  readonly project: Project;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  /** 父层 inline-edit 入口 — 父收到后把 label 切换成 input */
  readonly onStartRename: () => void;
  /** 任一 IPC 改完后通知父层刷新 project list (调 project.list + setProjects) */
  readonly onProjectsChanged: () => Promise<void>;
}

export function ProjectContextMenu({
  project,
  x,
  y,
  onClose,
  onStartRename,
  onProjectsChanged,
}: ProjectContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const isArchived = project.archived === true;

  // review HIGH-2 fix：用 useCallback 稳定 onToggleArchive / onRemove 引用，且按
  // 当前 project / isArchived deps 重建。effect 把它们 + onClose/onStartRename
  // 列进 deps，关掉 eslint-disable，避免 stale closure。
  const onToggleArchive = useCallback(async (): Promise<void> => {
    onClose();
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.recent.setArchived', {
      path: project.path,
      archived: !isArchived,
    });
    if (!r.ok || !r.data.ok) {
      pushToast('Failed to update archive state', 'error');
      return;
    }
    pushToast(isArchived ? 'Unarchived' : 'Archived', 'info', 1500);
    await onProjectsChanged();
  }, [project.path, isArchived, onClose, onProjectsChanged]);

  const onRemove = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    // review MED-3：confirm 先于 onClose — 用户取消则菜单仍可见，符合直觉
    const confirmed = window.confirm(
      `Remove "${project.name}" from KodaX Space?\n\nThis only removes it from your recent projects list. The folder on disk is not touched.`,
    );
    if (!confirmed) return;
    onClose();
    const r = await window.kodaxSpace.invoke('project.recent.remove', { path: project.path });
    if (!r.ok || !r.data.removed) {
      pushToast('Failed to remove project', 'error');
      return;
    }
    pushToast('Removed from Space', 'info', 1500);
    await onProjectsChanged();
  }, [project.path, project.name, onClose, onProjectsChanged]);

  useEffect(() => {
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onStartRename();
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void onToggleArchive();
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        void onRemove();
        return;
      }
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, onStartRename, onToggleArchive, onRemove]);

  // 屏幕边缘 clamp：菜单 ~180×96，若 x+180 > viewport 让它向左展开
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 110);

  return (
    <div
      ref={ref}
      // z-[100] 对齐 SessionContextMenu (一致 z-stack 减少未来万一双 menu 同屏时的层级 bug)
      className="fixed z-[100] min-w-[180px] bg-zinc-950 border border-zinc-800 rounded shadow-2xl text-xs py-1"
      style={{ left, top }}
      role="menu"
      aria-label={`${project.name} actions`}
    >
      <MenuRow label="Rename" hint="R" onClick={() => { onStartRename(); }} />
      <MenuRow
        label={isArchived ? 'Unarchive' : 'Archive'}
        hint="A"
        onClick={() => void onToggleArchive()}
      />
      <div className="my-1 border-t border-zinc-800/60" />
      <MenuRow label="Remove from Space" hint="D" danger onClick={() => void onRemove()} />
    </div>
  );
}

interface MenuRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly onClick: () => void;
  readonly danger?: boolean;
}

function MenuRow({ label, hint, onClick, danger }: MenuRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={`w-full text-left px-3 py-1 flex items-center justify-between hover:bg-zinc-800 ${
        danger ? 'text-red-400' : 'text-zinc-200'
      }`}
    >
      <span>{label}</span>
      {hint && <span className="text-zinc-500 text-[10px] ml-3">{hint}</span>}
    </button>
  );
}

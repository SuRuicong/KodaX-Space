// SettingsPopover — alpha.1
//
// 从 LocalChip 的 ⚙ 进入。最小可用面板：
//   - Default workspace 路径 (text input + Browse 按钮)
//   - Save → settings.setDefaultWorkspace (main ensure 目录存在)
//
// 改完默认 workspace 后，如果 currentProjectPath 还是旧默认（用户没显式切其他），
// 自动切到新默认 — 这样用户改完不用再手动 "Open folder"。

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

interface SettingsPopoverProps {
  onClose: () => void;
}

export function SettingsPopover({ onClose }: SettingsPopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [originalDefault, setOriginalDefault] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    void window.kodaxSpace.invoke('settings.get', {}).then((r) => {
      if (r.ok) {
        setDefaultWorkspace(r.data.defaultWorkspace);
        setOriginalDefault(r.data.defaultWorkspace);
      }
    });
  }, []);

  async function browseFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      setDefaultWorkspace(r.data.path);
    }
  }

  async function save(): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const trimmed = defaultWorkspace.trim();
      if (!trimmed) {
        setErr('Path cannot be empty.');
        return;
      }
      const r = await window.kodaxSpace.invoke('settings.setDefaultWorkspace', { path: trimmed });
      if (!r.ok) {
        setErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
        return;
      }
      // 如果当前 project 是旧默认，自动切到新默认（用户没在用其他 project 时让 UX 立即生效）
      if (currentProjectPath === originalDefault) {
        setCurrentProject(r.data.defaultWorkspace);
        await window.kodaxSpace.invoke('project.recent.add', { path: r.data.defaultWorkspace }).catch(() => {});
        const listR = await window.kodaxSpace.invoke('project.list', undefined);
        if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
      }
      setOriginalDefault(r.data.defaultWorkspace);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[480px] bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-4 text-sm text-zinc-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-zinc-100 font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Default workspace
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={defaultWorkspace}
                onChange={(e) => setDefaultWorkspace(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded focus:outline-none focus:border-zinc-700 font-mono"
                placeholder="C:\Users\you\kodax_workspace"
              />
              <button
                type="button"
                onClick={() => void browseFolder()}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded"
                title="Browse for folder"
              >
                Browse…
              </button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              New sessions default to this folder. Auto-created if it doesn't exist.
            </div>
          </div>

          {err && <div className="text-red-400 text-xs">{err}</div>}
          {saved && <div className="text-emerald-400 text-xs">Saved.</div>}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 text-zinc-400 hover:text-zinc-200"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || defaultWorkspace.trim() === originalDefault.trim()}
            className="text-xs px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-zinc-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

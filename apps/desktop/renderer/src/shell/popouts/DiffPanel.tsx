// DiffPanel — F011-revised
//
// Diff popout：复用 F009 的 MonacoDiffViewer + store 里 lastDiffPath（tool_call write/edit 写入）。
// 切换 popout 时如果有未读 lastDiffPath，自动用之；否则等用户输入路径。

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { MonacoDiffViewer } from '../../features/code/MonacoDiffViewer.js';

export function DiffPanel(): JSX.Element {
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const lastDiffPath = useAppStore((s) => s.lastDiffPath);
  const clearLastDiffPath = useAppStore((s) => s.clearLastDiffPath);

  const [path, setPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 接住 store 的 lastDiffPath（tool_call 自动注入）
  useEffect(() => {
    if (lastDiffPath !== null) {
      setPath(lastDiffPath);
      clearLastDiffPath();
    }
  }, [lastDiffPath, clearLastDiffPath]);

  useEffect(() => {
    if (!path || !projectRoot || !window.kodaxSpace) return;
    let cancelled = false;
    void window.kodaxSpace.invoke('files.diff', { projectRoot, path }).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data.available) {
        setDiff({ before: r.data.before, after: r.data.after });
        setErr(null);
      } else if (r.ok) {
        setDiff(null);
        setErr('No diff available — tool call cache miss');
      } else {
        setErr(`${r.error.code}: ${r.error.message}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, projectRoot]);

  if (!path) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs p-4 text-center">
        No diff selected. Run a write/edit tool to populate.
      </div>
    );
  }
  if (err) {
    return <div className="p-3 text-xs text-zinc-500 font-mono">{err}</div>;
  }
  if (!diff) {
    return <div className="p-3 text-xs text-zinc-500">loading…</div>;
  }
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1 border-b border-zinc-900 text-[11px] text-zinc-500 font-mono truncate flex-shrink-0">
        {path}
      </div>
      <div className="flex-1 min-h-0">
        <MonacoDiffViewer path={path} before={diff.before} after={diff.after} />
      </div>
    </div>
  );
}

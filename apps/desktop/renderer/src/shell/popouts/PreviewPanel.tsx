// PreviewPanel — F011-revised
//
// 文件预览 popout：复用 F009 的 MonacoViewer 组件。
// 路径输入：当前 alpha.1 用对话流里"最近被 read 的文件路径"作为默认（store lastReadPath）。
// 后续可扩展：搜索框 + 历史最近 N 个文件。

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { MonacoViewer } from '../../features/code/MonacoViewer.js';

interface FileContent {
  content: string;
  isBinary: boolean;
  truncated: boolean;
  size: number;
}

export function PreviewPanel(): JSX.Element {
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const [path, setPath] = useState<string>('');
  const [pathInput, setPathInput] = useState<string>('');
  const [file, setFile] = useState<FileContent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!path || !projectRoot || !window.kodaxSpace) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    void window.kodaxSpace
      .invoke('files.read', { projectRoot, path })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setFile({
            content: r.data.content,
            isBinary: r.data.isBinary,
            truncated: r.data.truncated,
            size: r.data.size,
          });
        } else {
          setErr(`${r.error.code}: ${r.error.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectRoot]);

  return (
    <div className="h-full flex flex-col">
      <form
        className="px-3 py-2 border-b border-zinc-900 flex-shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          setPath(pathInput.trim());
        }}
      >
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          placeholder="path/to/file.ts (relative to project root)"
          className="w-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded focus:outline-none focus:border-zinc-700"
        />
      </form>
      <div className="flex-1 min-h-0 relative">
        {!path && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-xs">
            Enter a path above.
          </div>
        )}
        {busy && <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs">loading…</div>}
        {err && <div className="p-3 text-xs text-red-400 font-mono">{err}</div>}
        {!busy && !err && file?.truncated && (
          <div className="flex items-center justify-center h-full text-xs text-zinc-500 p-4 text-center">
            File too large ({(file.size / 1048576).toFixed(2)} MB) — viewer cap is 5 MB.
          </div>
        )}
        {!busy && !err && file?.isBinary && (
          <div className="flex items-center justify-center h-full text-xs text-zinc-500 p-4 text-center">
            <code className="font-mono">{path}</code> appears to be binary.
          </div>
        )}
        {!busy && !err && file && !file.truncated && !file.isBinary && (
          <MonacoViewer path={path} content={file.content} />
        )}
      </div>
    </div>
  );
}

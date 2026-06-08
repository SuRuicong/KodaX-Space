// PreviewPanel — F011-revised
//
// 文件预览 popout：复用 F009 的 MonacoViewer 组件。
// 路径输入：当前 alpha.1 用对话流里"最近被 read 的文件路径"作为默认（store lastReadPath）。
// 后续可扩展：搜索框 + 历史最近 N 个文件。

import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { MonacoViewer } from '../../features/code/MonacoViewer.js';
// F024 富预览：PDF / docx / xlsx 各自 lazy 加载（每个 viewer 自己一个 chunk）
import { RichPreview } from '../../features/preview/RichPreview.js';
import { detectKind } from '../../features/preview/binaryUtils.js';

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

  const richKind = path !== '' ? detectKind(path) : null;

  useEffect(() => {
    // 富类型走 RichPreview 自己拉 binary；这里只负责文本路径
    if (richKind !== null) {
      setFile(null);
      setErr(null);
      setBusy(false);
      return;
    }
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
  }, [path, projectRoot, richKind]);

  return (
    <div className="h-full flex flex-col">
      <form
        className="px-3 py-2 border-b border-border-default flex-shrink-0"
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
          className="w-full bg-surface-2 border border-border-default text-xs text-fg-primary px-2 py-1 rounded focus:outline-none focus:border-border-strong"
        />
      </form>
      <div className="flex-1 min-h-0 relative">
        {!path && (
          <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
            Enter a path above.
          </div>
        )}
        {path !== '' && richKind !== null && projectRoot !== null && (
          <RichPreview projectRoot={projectRoot} path={path} kind={richKind} />
        )}
        {richKind === null && busy && (
          <div className="absolute inset-0 flex items-center justify-center text-fg-muted text-xs">
            loading…
          </div>
        )}
        {richKind === null && err && (
          <div className="p-3 text-xs text-red-400 font-mono">{err}</div>
        )}
        {richKind === null && !busy && !err && file?.truncated && (
          <div className="flex items-center justify-center h-full text-xs text-fg-muted p-4 text-center">
            File too large ({(file.size / 1048576).toFixed(2)} MB) — viewer cap is 5 MB.
          </div>
        )}
        {richKind === null && !busy && !err && file?.isBinary && (
          <div className="flex items-center justify-center h-full text-xs text-fg-muted p-4 text-center">
            <code className="font-mono">{path}</code> appears to be binary.
          </div>
        )}
        {richKind === null && !busy && !err && file && !file.truncated && !file.isBinary && (
          <MonacoViewer path={path} content={file.content} />
        )}
      </div>
    </div>
  );
}

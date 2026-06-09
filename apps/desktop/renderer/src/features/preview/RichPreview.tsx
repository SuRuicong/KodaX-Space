// RichPreview — F024 dispatcher
//
// 由 PreviewPanel 在 detectKind 命中 PDF/docx/xlsx 时呈现。
// 1) 调 files.readBinary 拿 base64 + 大小校验
// 2) lazy 加载对应 viewer，每个 viewer 自己一个 chunk
// 3) 错误 / truncated / 加载中分别有 placeholder

import { Suspense, lazy, useEffect, useState } from 'react';
import { PREVIEW_SIZE_CAPS, formatBytes, type RichPreviewKind } from './binaryUtils.js';

const PdfViewer = lazy(() => import('./PdfViewer.js').then((m) => ({ default: m.PdfViewer })));
const DocxViewer = lazy(() => import('./DocxViewer.js').then((m) => ({ default: m.DocxViewer })));
const XlsxViewer = lazy(() => import('./XlsxViewer.js').then((m) => ({ default: m.XlsxViewer })));

interface Props {
  readonly projectRoot: string;
  readonly path: string;
  readonly kind: RichPreviewKind;
}

export function RichPreview({ projectRoot, path, kind }: Props): JSX.Element {
  const [base64, setBase64] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<{ size: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.kodaxSpace) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setBase64(null);
    setTruncated(null);

    void window.kodaxSpace
      .invoke('files.readBinary', {
        projectRoot,
        path,
        maxBytes: PREVIEW_SIZE_CAPS[kind],
      })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setErr('Failed to load file');
          return;
        }
        if (r.data.truncated) {
          setTruncated({ size: r.data.size });
          return;
        }
        setBase64(r.data.base64);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot, path, kind]);

  if (busy && base64 === null) {
    return <div className="p-3 text-xs text-fg-muted">Loading…</div>;
  }
  if (err !== null) {
    return <div className="p-3 text-xs text-danger">{err}</div>;
  }
  if (truncated !== null) {
    return (
      <div className="p-4 text-xs text-fg-muted text-center">
        File too large to preview ({formatBytes(truncated.size)}). Cap for {kind.toUpperCase()} is{' '}
        {formatBytes(PREVIEW_SIZE_CAPS[kind])}.
      </div>
    );
  }
  if (base64 === null) return <div className="p-3 text-xs text-fg-muted">No content.</div>;

  return (
    <Suspense fallback={<div className="p-3 text-xs text-fg-muted">Loading viewer…</div>}>
      {kind === 'pdf' && <PdfViewer base64={base64} />}
      {kind === 'docx' && <DocxViewer base64={base64} />}
      {kind === 'xlsx' && <XlsxViewer base64={base64} />}
    </Suspense>
  );
}

// PdfViewer — F024 PDF 渲染
//
// 用 pdfjs-dist 4.x ESM build。Vite `?url` 拿 worker 资源 URL，pdfjs 自己起 worker。
// 单页 canvas 渲染 + 上下分页按钮。MVP 不做缩放 / 文本搜索 / 注释 — 那些等用户提需求。

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// Vite ?url 把 worker 文件 emit 成静态 asset 并返 URL
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { base64ToBytes } from './binaryUtils.js';

// Module-level set worker — pdfjs internal singleton, 多次 set 同值幂等
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  readonly base64: string;
}

export function PdfViewer({ base64 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // Load document on base64 change
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setPageNum(1);

    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    try {
      const bytes = base64ToBytes(base64);
      // pdfjs hardening (security review):
      //   - isEvalSupported: false → 禁用 PostScript Type 4 JIT (`new Function`);
      //     CSP 在生产里已经拦了 eval，但显式 opt-out 让 worker 不再走 fallback 错误路径
      //   - disableAutoFetch: true → 显式不让 pdfjs 主动外网拉外部资源 (CMaps/字体等)
      loadingTask = pdfjs.getDocument({
        data: bytes,
        isEvalSupported: false,
        disableAutoFetch: true,
      });
    } catch {
      setErr('Failed to decode PDF data');
      setBusy(false);
      return;
    }

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setTotalPages(doc.numPages);
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr('Failed to open PDF');
        setBusy(false);
      });

    return () => {
      cancelled = true;
      if (loadingTask !== null) void loadingTask.destroy();
      const prev = docRef.current;
      docRef.current = null;
      if (prev !== null) void prev.destroy();
    };
  }, [base64]);

  // Render current page
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (doc === null || canvas === null || busy || err !== null) return;
    if (pageNum < 1 || pageNum > totalPages) return;

    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;

    void doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.25 });
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      // dpi-aware sizing — 高分屏 canvas 不模糊。
      // dpr cap 在 2 — 否则 3x retina + 大幅 PDF (A0/工程图) 单 canvas backing store
      // 可飙到 100MB+。视觉上 dpr=2 在常规阅读距离已不可见提升 (review MEDIUM-3)
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      task = page.render({ canvasContext: ctx, viewport });
      task.promise.catch(() => {
        /* render cancelled by next page */
      });
    });

    return () => {
      cancelled = true;
      if (task !== null) task.cancel();
    };
  }, [pageNum, busy, err, totalPages]);

  if (err !== null) {
    return <div className="p-3 text-xs text-red-400">{err}</div>;
  }
  if (busy) {
    return <div className="p-3 text-xs text-fg-muted">Loading PDF…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1 border-b border-border-default/60 flex items-center gap-2 text-xs text-fg-muted flex-shrink-0">
        <button
          type="button"
          className="px-2 py-0.5 rounded hover:bg-hover-bg disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => setPageNum((n) => Math.max(1, n - 1))}
          disabled={pageNum <= 1}
        >
          ←
        </button>
        <span>
          {pageNum} / {totalPages}
        </span>
        <button
          type="button"
          className="px-2 py-0.5 rounded hover:bg-hover-bg disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}
          disabled={pageNum >= totalPages}
        >
          →
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex items-start justify-center bg-surface-2">
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>
    </div>
  );
}

// SandboxFrame — mounts the LiveCanvas sandbox <iframe> and drives the
// @livecanvas/sandbox-bridge `createHost` handshake to inject one artifact.
//
// 路径 D (记忆 livecanvas_artifact_plan): the renderer is the PARENT frame; the
// iframe (served by Space's loopback server on 127.0.0.1) is the child. On the
// child's `lc:ready`, the host posts `lc:artifact {code, bootstrap}`; the shell
// evals the code with react-runner against its whitelisted scope (recharts, etc.).
//
// Two effects, deliberately split (P2-safe):
//   - host lifecycle keyed on indexUrl/sandboxOrigin (iframe (re)loads → new host),
//   - artifact (re)send keyed on code/artifactId (the iframe is already loaded;
//     swapping code must NOT tear down/reload the iframe — it just re-posts).
// Without the split, changing `code` would dispose+recreate the host while the
// iframe stays loaded, so no new `lc:ready` arrives and the handshake times out.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createHost, type Host } from '@livecanvas/sandbox-bridge';

export interface SandboxFrameProps {
  /** Iframe src (sandbox indexUrl, carries lc_parent_origin). */
  indexUrl: string;
  /** Bare origin of the sandbox server — used to lock postMessage. */
  sandboxOrigin: string;
  /** Artifact source code (react-runner module; default-exports a component). */
  code: string;
  /** Stable id for the artifact (used in bootstrap). */
  artifactId: string;
}

type FrameStatus = 'loading' | 'ready' | 'error' | 'timeout';

export function SandboxFrame({ indexUrl, sandboxOrigin, code, artifactId }: SandboxFrameProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<Host | null>(null);
  const readyRef = useRef(false);
  // Latest artifact, read by the host's onReady (which fires after the deps that
  // created it) and by the re-send effect.
  const artifactRef = useRef({ code, artifactId });
  artifactRef.current = { code, artifactId };

  const [status, setStatus] = useState<FrameStatus>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const sendCurrent = useCallback(() => {
    const host = hostRef.current;
    if (!host || !readyRef.current) return;
    const current = artifactRef.current;
    host.sendArtifact({
      type: 'lc:artifact',
      code: current.code,
      bootstrap: {
        artifactId: current.artifactId,
        // Static artifact: no backend. Placeholder satisfies the schema (min
        // length) but is never used by the smoke artifact. P2/P3 NOTE: when real
        // tokens are wired, untrusted artifact code will see bootstrap.scopedToken
        // — it must be op-scoped + server-enforced, never a broad credential.
        scopedToken: 'static-artifact-no-backend-placeholder',
        apiBase: sandboxOrigin,
        sandboxOrigin,
      },
    });
  }, [sandboxOrigin]);

  // Host lifecycle — re-runs only when the iframe actually (re)loads.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    readyRef.current = false;
    setStatus('loading');
    setErrMsg(null);

    const host = createHost({
      iframe,
      sandboxOrigin,
      onReady: () => {
        readyRef.current = true;
        setStatus('ready');
        sendCurrent();
      },
      onError: (msg) => {
        setStatus('error');
        setErrMsg(msg.message);
      },
      onTimeout: () => setStatus('timeout'),
    });
    hostRef.current = host;

    return () => {
      host.dispose();
      hostRef.current = null;
      readyRef.current = false;
    };
  }, [indexUrl, sandboxOrigin, sendCurrent]);

  // Re-send when the artifact changes but the iframe/host is already up.
  useEffect(() => {
    if (readyRef.current) sendCurrent();
  }, [code, artifactId, sendCurrent]);

  return (
    <div className="relative flex-1 min-h-0">
      <iframe
        ref={iframeRef}
        src={indexUrl}
        title="Artifact preview"
        className="w-full h-full border-0 bg-white"
        // The iframe is cross-origin (127.0.0.1:<port> ≠ renderer origin
        // localhost:5173 / app://space), so the browser already isolates its DOM
        // from the parent. allow-same-origin keeps the iframe's OWN origin (so the
        // postMessage handshake's origin checks work); it does NOT make the iframe
        // same-origin with the parent. allow-scripts is required (react-runner evals).
        sandbox="allow-scripts allow-same-origin"
      />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-center p-4 pointer-events-none">
          <div className="text-[11px] text-fg-muted leading-relaxed">
            {status === 'loading' && '正在加载预览…'}
            {status === 'timeout' && '预览加载超时（sandbox 未握手）。'}
            {status === 'error' && `预览出错：${errMsg ?? '未知错误'}`}
          </div>
        </div>
      )}
    </div>
  );
}

// Renderer hook: learn where the self-hosted LiveCanvas sandbox is served.
//
// 路径 D (记忆 livecanvas_artifact_plan). Calls artifact.sandboxInfo once on mount.
// `unavailable` (with a reason) is the normal state when the sandbox bundle isn't
// installed/mountable — the panel shows a placeholder, not a broken iframe.

import { useEffect, useState } from 'react';

export interface SandboxReady {
  indexUrl: string;
  sandboxOrigin: string;
  shellVersion?: string;
}

export type SandboxInfoState =
  | { status: 'loading' }
  | { status: 'ready'; sandbox: SandboxReady }
  | { status: 'unavailable'; error: string };

export function useSandboxInfo(): SandboxInfoState {
  const [state, setState] = useState<SandboxInfoState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    const bridge = window.kodaxSpace;
    if (!bridge) {
      setState({ status: 'unavailable', error: 'IPC bridge unavailable' });
      return;
    }
    bridge
      .invoke('artifact.sandboxInfo', undefined)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setState({ status: 'unavailable', error: res.error.message });
          return;
        }
        const info = res.data;
        if (info.ready && info.indexUrl && info.sandboxOrigin) {
          setState({
            status: 'ready',
            sandbox: {
              indexUrl: info.indexUrl,
              sandboxOrigin: info.sandboxOrigin,
              shellVersion: info.shellVersion,
            },
          });
        } else {
          setState({ status: 'unavailable', error: info.error ?? 'sandbox not ready' });
        }
      })
      .catch((err: unknown) => {
        if (alive) setState({ status: 'unavailable', error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

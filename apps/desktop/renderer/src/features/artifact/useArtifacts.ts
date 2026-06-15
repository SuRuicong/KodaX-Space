// Renderer hooks for the artifact store (F059): list a session's artifacts (live,
// re-fetched on artifact.changed) and read one version's content.

import { useEffect, useState } from 'react';
import type { ArtifactRefT } from '@kodax-space/space-ipc-schema';
import type { ArtifactVersionPayload } from './toArtifactContent';

/** Live list of a session's artifacts; re-fetches on artifact.changed push. */
export function useArtifacts(sessionId: string | null): {
  artifacts: readonly ArtifactRefT[];
  loading: boolean;
} {
  const [artifacts, setArtifacts] = useState<readonly ArtifactRefT[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !sessionId) {
      setArtifacts([]);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      setLoading(true);
      bridge
        .invoke('artifact.list', { sessionId })
        .then((res) => {
          if (!alive) return;
          setArtifacts(res.ok ? res.data.artifacts : []);
          setLoading(false);
        })
        .catch(() => {
          if (alive) setLoading(false);
        });
    };
    // Trailing debounce — bounds IPC churn under high-cadence agent writes.
    const scheduleLoad = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 200);
    };
    load();
    const off = bridge.on('artifact.changed', (payload) => {
      // Skip events that belong to a different session (delete omits sessionId →
      // always reload, since it may have removed one of ours).
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      scheduleLoad();
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [sessionId]);

  return { artifacts, loading };
}

/** Read one artifact version's payload (content for content kinds, path for doc kinds). */
export function useArtifactContent(
  id: string | null,
  version: number | undefined,
): { payload: ArtifactVersionPayload | null; loading: boolean } {
  const [payload, setPayload] = useState<ArtifactVersionPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge || !id) {
      setPayload(null);
      return;
    }
    let alive = true;
    setLoading(true);
    bridge
      .invoke('artifact.read', version !== undefined ? { id, version } : { id })
      .then((res) => {
        if (!alive) return;
        setPayload(res.ok ? { content: res.data.content, path: res.data.path } : null);
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setPayload(null);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, version]);

  return { payload, loading };
}

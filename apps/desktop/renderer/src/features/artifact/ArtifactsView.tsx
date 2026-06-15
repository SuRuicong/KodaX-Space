// ArtifactsView (F059b) — the shared artifact display body: list selector +
// version switcher + ArtifactView render + empty/loading. Surface-agnostic, so
// it's reused by Partner's ArtifactPanel (right column), the Coder RightSidebar
// "Artifact" section, and the full-screen PopoutOverlay. Reads the current
// session from appStore; artifacts are the current session's (any surface).

import { useEffect, useMemo, useState } from 'react';
import { FileOutput } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ArtifactView } from './ArtifactView';
import { useArtifacts, useArtifactContent } from './useArtifacts';
import { toArtifactContent } from './toArtifactContent';
import type { ArtifactRefT } from '@kodax-space/space-ipc-schema';

export function ArtifactsEmptyState(): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <FileOutput className="w-6 h-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
      <div className="text-[12px] text-fg-secondary font-medium">产出会显示在这里</div>
      <div className="text-[11px] text-fg-muted leading-relaxed max-w-[200px]">
        报告 / 图表 / 文档 / 代码等产物可预览。
      </div>
    </div>
  );
}

/** Reads + renders one artifact's selected version. */
function ArtifactViewer({ artifact, projectRoot }: { artifact: ArtifactRefT; projectRoot: string | null }): JSX.Element {
  const [version, setVersion] = useState<number | undefined>(undefined); // undefined = current
  const { payload, loading } = useArtifactContent(artifact.id, version);
  const effectiveVersion = version ?? artifact.currentVersion;

  const content = useMemo(
    () => (payload ? toArtifactContent(artifact.kind, payload, projectRoot) : null),
    [payload, artifact.kind, projectRoot],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {artifact.versions.length > 1 && (
        <div className="px-3 py-1.5 border-b border-border-default flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-fg-muted">版本</span>
          <select
            className="text-[11px] bg-surface-raised border border-border-default rounded px-1 py-0.5 text-fg-secondary"
            value={effectiveVersion}
            onChange={(e) => setVersion(Number(e.target.value))}
          >
            {artifact.versions.map((v) => (
              <option key={v.v} value={v.v}>
                v{v.v}
                {v.v === artifact.currentVersion ? ' (最新)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {loading && !content ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-fg-muted">加载中…</div>
      ) : content ? (
        <ArtifactView {...content} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center">
          此产物暂无法预览。
        </div>
      )}
    </div>
  );
}

export function ArtifactsView(): JSX.Element {
  const sessionId = useAppStore((s) => s.currentSessionId);
  const projectRoot = useAppStore((s) => {
    const cur = s.currentSessionId;
    return cur ? (s.sessions.find((x) => x.sessionId === cur)?.projectRoot ?? null) : null;
  });
  const { artifacts, loading } = useArtifacts(sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset selection when switching sessions (this view isn't remounted on switch).
  useEffect(() => {
    setSelectedId(null);
  }, [sessionId]);

  // Default selection = most recently updated (list is sorted updatedAt desc).
  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0] ?? null;

  if (artifacts.length === 0) {
    return loading ? (
      <div className="flex-1 flex items-center justify-center text-[11px] text-fg-muted">加载中…</div>
    ) : (
      <ArtifactsEmptyState />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {artifacts.length > 1 && (
        <div className="px-3 py-1.5 border-b border-border-default flex-shrink-0">
          <select
            className="w-full text-[11px] bg-surface-raised border border-border-default rounded px-1.5 py-1 text-fg-secondary"
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {artifacts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {selected ? <ArtifactViewer key={selected.id} artifact={selected} projectRoot={projectRoot} /> : <ArtifactsEmptyState />}
    </div>
  );
}

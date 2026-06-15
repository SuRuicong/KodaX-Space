// ArtifactsView (F059b) — the shared artifact display body: list selector +
// version switcher + ArtifactView render + empty/loading. Surface-agnostic, so
// it's reused by Partner's ArtifactPanel (right column), the Coder RightSidebar
// "Artifact" section, and the full-screen PopoutOverlay. Reads the current
// session from appStore; artifacts are the current session's (any surface).

import { useEffect, useMemo, useState } from 'react';
import { FileOutput, Copy, Check, Download, RefreshCw, Maximize2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ArtifactView } from './ArtifactView';
import { useArtifacts, useArtifactContent } from './useArtifacts';
import { toArtifactContent } from './toArtifactContent';
import { TEXT_COPY_KINDS } from './artifactKind';
import type { ArtifactRefT } from '@kodax-space/space-ipc-schema';

export function ArtifactsEmptyState(): JSX.Element {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
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
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const setActivePopoutKind = useAppStore((s) => s.setActivePopoutKind);

  const content = useMemo(
    () => (payload ? toArtifactContent(artifact.kind, payload, projectRoot) : null),
    [payload, artifact.kind, projectRoot],
  );

  const canCopy = payload?.content !== undefined && TEXT_COPY_KINDS.has(artifact.kind);
  const canSave = payload?.content !== undefined; // content kinds incl. image; doc has no content

  async function onCopy(): Promise<void> {
    if (payload?.content == null) return;
    try {
      await navigator.clipboard.writeText(payload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionMsg('复制失败');
      setTimeout(() => setActionMsg(null), 2000);
    }
  }

  async function onSave(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    const r = await bridge.invoke('artifact.export', { id: artifact.id, version: effectiveVersion });
    if (!r.ok) {
      // IPC-level failure (e.g. fs.writeFile threw: permission denied / disk full)
      setActionMsg('保存失败');
      setTimeout(() => setActionMsg(null), 2500);
    } else if (r.data.ok) {
      setActionMsg('已保存');
      setTimeout(() => setActionMsg(null), 1500);
    } else if (!r.data.canceled) {
      setActionMsg(r.data.error ?? '保存失败');
      setTimeout(() => setActionMsg(null), 2500);
    } // canceled → no message
  }

  // "再改一版": prefill the composer with a revision instruction referencing this
  // artifact's id; the agent reuses it in create_artifact to add a new version.
  // (Agent-driven → verified with a real LLM session; the prefill itself is local.)
  function onIterate(): void {
    const text = `修改 artifact「${artifact.title}」（artifactId: ${artifact.id}）——基于当前内容改，用 create_artifact 复用该 id 产出新版本。改动要求：`;
    window.dispatchEvent(new CustomEvent('kodax-space.compose-prefill', { detail: { text } }));
    setActivePopoutKind(null); // 若在全屏 popout，关掉让用户看到输入框（侧栏/Partner 下无害）
  }

  // "单独打开"：F059c L3 —— 开独立最大化窗口看这份 artifact（escalation 第三级）。
  async function onOpenWindow(): Promise<void> {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    await bridge.invoke('artifact.openWindow', {
      id: artifact.id,
      version: effectiveVersion,
      projectRoot: projectRoot ?? undefined,
      title: artifact.title,
    });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* toolbar 恒显示：再改一版对任何 artifact 都可用 */}
      <div className="px-3 py-1.5 border-b border-border-default flex items-center gap-2 flex-shrink-0">
          {artifact.versions.length > 1 && (
            <>
              <span className="text-[10px] text-fg-muted">版本</span>
              <select
                className="text-[11px] bg-surface-raised border border-border-default rounded px-1 py-0.5 text-fg-secondary"
                value={effectiveVersion}
                onChange={(e) => setVersion(Number(e.target.value))}
              >
                {artifact.versions
                  .slice()
                  .sort((a, b) => b.v - a.v)
                  .map((v) => (
                    <option key={v.v} value={v.v}>
                      v{v.v}
                      {v.v === artifact.currentVersion ? ' (最新)' : ''}
                    </option>
                  ))}
              </select>
            </>
          )}
          {actionMsg && <span className="text-[10px] text-fg-muted truncate">{actionMsg}</span>}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={onIterate}
              title="再改一版（让 agent 基于当前内容产新版本）"
              aria-label="再改一版"
              className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
            {canCopy && (
              <button
                type="button"
                onClick={() => void onCopy()}
                title="复制内容"
                aria-label="复制内容"
                className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-ok" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />}
              </button>
            )}
            {canSave && (
              <button
                type="button"
                onClick={() => void onSave()}
                title="另存为…"
                aria-label="另存为"
                className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void onOpenWindow()}
              title="单独打开（独立最大化窗口）"
              aria-label="单独打开"
              className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            >
              <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
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
      <div className="h-full flex items-center justify-center text-[11px] text-fg-muted">加载中…</div>
    ) : (
      <ArtifactsEmptyState />
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
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

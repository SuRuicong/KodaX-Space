// ChipBar — F011-revised (alpha.1) + F015 (v0.1.2)
//
// 输入框上方 working-context 行：
//   📍 Local · 📁 KodaX-Space · 🌿 main · 🧠 Repointel · ☑ worktree
//
// 每个 chip 可点开 dropdown — 对齐 Claude Code New session 三张截图：
//   - Local chip → Local ✓ + ⚙ (打开 Settings popover 改默认 workspace)
//   - Project chip → Recent + Open folder...
//   - Branch chip → branches list (alpha.1 占位, v0.1.x 接 git)
//   - Repointel chip (F015) → 当前 mode (auto/oss/premium-*) + 最近 traces 列表

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { SettingsModal } from '../features/settings/SettingsModal.js';

export function ChipBar(): JSX.Element | null {
  const projectPath = useAppStore((s) => s.currentProjectPath);

  if (!projectPath) return null;
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
      <LocalChip />
      <ProjectChip projectName={projectName} projectPath={projectPath} />
      <BranchChip />
      <RepointelChip />
    </div>
  );
}

/** Local chip — 当前 Local execution + ⚙ 改默认 workspace。 */
function LocalChip(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-default hover:bg-hover-bg"
        title="Execution location"
      >
        <span aria-hidden>📍</span>
        <span>Local</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-48 bg-surface-2 border border-border-default rounded shadow-xl py-1 z-50">
          <div className="px-3 py-1.5 hover:bg-hover-bg flex items-center gap-2 text-xs text-fg-primary">
            <span>Local</span>
            <span className="text-emerald-500 ml-auto" aria-hidden>
              ✓
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen(true);
                setOpen(false);
              }}
              className="text-fg-muted hover:text-fg-primary ml-1"
              title="Settings — change default workspace"
              aria-label="Open settings"
            >
              ⚙
            </button>
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal initialTab="preferences" onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

/** Project chip — Recent + Open folder. 截图 2 同款。 */
function ProjectChip({
  projectName,
  projectPath,
}: {
  projectName: string;
  projectPath: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const projects = useAppStore((s) => s.projects);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function pickPath(path: string): Promise<void> {
    if (!window.kodaxSpace) return;
    setCurrentProject(path);
    await window.kodaxSpace.invoke('project.recent.add', { path });
    const listR = await window.kodaxSpace.invoke('project.list', undefined);
    if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
    setOpen(false);
  }

  async function openDialog(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      await pickPath(r.data.path);
    } else {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-default hover:bg-hover-bg max-w-[200px]"
        title={projectPath}
      >
        <span aria-hidden>📁</span>
        <span className="truncate">{projectName}</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-56 bg-surface-2 border border-border-default rounded shadow-xl py-1 z-50">
          <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider">Recent</div>
          {projects.length === 0 ? (
            <div className="px-3 py-1 text-[11px] text-fg-muted">No recent projects yet.</div>
          ) : (
            projects.slice(0, 8).map((p) => {
              const isCurrent = p.path === projectPath;
              return (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => void pickPath(p.path)}
                  className={`w-full text-left px-3 py-1 hover:bg-hover-bg flex items-center gap-2 text-xs ${
                    isCurrent ? 'text-fg-primary' : 'text-fg-secondary'
                  }`}
                  title={p.path}
                >
                  <span className="truncate flex-1">{p.name}</span>
                  {isCurrent && (
                    <span className="text-emerald-500" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              );
            })
          )}
          <div className="border-t border-border-default my-1" />
          <button
            type="button"
            onClick={() => void openDialog()}
            className="w-full text-left px-3 py-1 hover:bg-hover-bg text-xs text-fg-primary"
          >
            Open folder…
          </button>
        </div>
      )}
    </div>
  );
}

/** Branch chip — alpha.1 占位；v0.1.x 接 git。 */
function BranchChip(): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-default"
      title="Branch detection — v0.1.x (git branches dropdown)"
    >
      <span aria-hidden>🌿</span>
      <span className="truncate max-w-[120px]">main</span>
    </span>
  );
}

// ---- F015 Repointel chip ----

interface RepointelTraceSlim {
  readonly kind: string;
  readonly mode?: string;
  readonly engine?: string;
  readonly bridge?: string;
  readonly status?: string;
  readonly latencyMs?: number;
  readonly cacheHit?: boolean;
}

const REPOINTEL_MODE_LABEL: Record<string, string> = {
  off: 'off',
  oss: 'OSS',
  'premium-shared': 'Premium (shared)',
  'premium-native': 'Premium',
  auto: 'auto',
};

/**
 * Repointel chip —— 显示当前 session 最近一次 repo-intelligence trace 的状态。
 * SDK `onRepoIntelligenceTrace` 回调走 main → push channel → renderer events buffer。
 * 这里从 buffer 倒扫拿最近一条，pill 显示 mode + status，点开看最近 3 条 trace。
 *
 * 无 active session / 还没 trace 到达 → 灰色 idle pill；trace 到了就上色。
 * v0.1.2 暂不做 auto-warm —— SDK 还没暴露 standalone warm API，
 * runKodaX 第一次 send 会自动 warm 进 trace，这里被动展示就够。
 */
function RepointelChip(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  // 订阅原始 events array，避免 selector 返回新数组引用造成 zustand re-render 风暴
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] : undefined,
  );
  // useMemo 派生最近 3 条 trace —— 空时复用 EMPTY_TRACES 常引用
  const latestTraces = useMemo<readonly RepointelTraceSlim[]>(() => {
    if (!events || events.length === 0) return EMPTY_TRACES;
    const collected: RepointelTraceSlim[] = [];
    for (let i = events.length - 1; i >= 0 && collected.length < 3; i--) {
      const ev = events[i] as unknown as { kind: string; event?: RepointelTraceSlim };
      if (ev.kind === 'repointel_trace' && ev.event) collected.push(ev.event);
    }
    return collected.length === 0 ? EMPTY_TRACES : collected;
  }, [events]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // 无 session 不显示 — ChipBar 整体已经在没 projectPath 时不渲染，这里再细化"无 session"
  if (!currentSessionId) return null;

  const latest = latestTraces[0];
  const mode = latest?.mode;
  const modeLabel = mode ? (REPOINTEL_MODE_LABEL[mode] ?? mode) : 'idle';
  const dotColor =
    mode === undefined
      ? 'bg-fg-muted'
      : mode === 'off'
        ? 'bg-fg-muted'
        : mode === 'oss'
          ? 'bg-emerald-500'
          : mode === 'premium-shared' || mode === 'premium-native'
            ? 'bg-blue-500'
            : 'bg-amber-500';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-default hover:bg-hover-bg"
        title={`Repo-intelligence: ${modeLabel}${latest?.status ? ` · ${latest.status}` : ''}`}
      >
        <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className="font-mono">Repointel</span>
        <span className="text-fg-muted">·</span>
        <span className="font-mono">{modeLabel}</span>
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-72 bg-surface-2 border border-border-default rounded shadow-xl py-1 z-50">
          <div className="px-3 py-1 text-fg-muted text-[11px] uppercase tracking-wider flex justify-between">
            <span>Repointel · {modeLabel}</span>
            <span className="text-fg-faint normal-case tracking-normal">latest 3 traces</span>
          </div>
          {latestTraces.length === 0 ? (
            <div className="px-3 py-1.5 text-[11px] text-fg-muted italic">
              No traces yet — repo-intel runs on first send.
            </div>
          ) : (
            latestTraces.map((t, i) => (
              <div
                key={i}
                className="px-3 py-1 border-t border-border-default/60 text-[11px] font-mono"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-fg-secondary truncate">{t.kind}</span>
                  {t.latencyMs !== undefined && (
                    <span className="text-fg-muted flex-shrink-0">{t.latencyMs}ms</span>
                  )}
                </div>
                {(t.status || t.engine || t.bridge !== undefined) && (
                  <div className="text-fg-muted truncate">
                    {[
                      t.status,
                      t.engine,
                      t.bridge ? `bridge:${t.bridge}` : null,
                      t.cacheHit ? 'cache-hit' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// 稳定空数组：让 selector 没 trace 时返同一引用，避免 zustand 误判 re-render
const EMPTY_TRACES: readonly RepointelTraceSlim[] = [];

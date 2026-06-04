// RightSidebar — F041 (v0.1.4) "任务态 mission control"
//
// 重塑前：Progress / Working folder / Context 三节，Progress 与 PlanPanel popout 重复渲染同一份 todoList。
// 重塑后：Plan / Workers / Changes 三节常驻（默认展开）+ Working folder / Context 降级到底部（默认折叠）。
// 退役 StashNotice 横幅（计数版"● Uncommitted: N modified..."），其职责由 Changes 节文件列表上位替代。
//
// 数据源：
//   - Plan:    todoListBySession（同 PlanPanel popout 单一来源，删除原 ProgressSection 重复）
//   - Workers: managedTaskStatusBySession + buildWorkerTree（同 TasksPanel popout 单一来源）
//   - Changes: project.gitChanges IPC（新增，F041 加；同款 5s TTL cache + 200 文件上限）
//   - Working folder: currentProjectPath
//   - Context:        eventsBySession[sid].tool_start 投影
//
// 每节标题右侧的 ⤢ 按钮 → requestPopout(kind) 弹原 overlay 看完整细节。Plan/Workers/Diff overlays 复用。
//
// CommandToolbar 的 POPOUTS 移除了 tasks / plan（避免两个入口重复触发 PlanPanel / TasksPanel）；
// Diff / Preview / Terminal / Agents / MCP 保留。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { buildWorkerTree } from './popouts/worker-tree.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

export function RightSidebar(): JSX.Element {
  return (
    <aside className="w-72 border-l border-border-default bg-surface flex flex-col flex-shrink-0 overflow-y-auto">
      {/* 三节"任务态" — 常驻摘要，⤢ 按需弹大图 */}
      <PlanSection />
      <WorkersSection />
      <ChangesSection />
      {/* 旧两节降级 — 信息密度低，默认折叠置底 */}
      <WorkingFolderSection />
      <ContextSection />
    </aside>
  );
}

// ---- Section 容器 ----

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  /** F041: 设了的话 header 右侧显示 `⤢` 按钮，点击触发 requestPopout(popoutKind)。 */
  popoutKind?: string;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = true, popoutKind, children }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const requestPopout = useAppStore((s) => s.requestPopout);
  return (
    <section className="border-b border-border-default/60">
      <div className="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-fg-muted">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left hover:text-fg-primary flex items-center gap-1.5"
          aria-expanded={open}
        >
          <span>{title}</span>
        </button>
        <div className="flex items-center gap-1">
          {popoutKind && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                requestPopout(popoutKind);
              }}
              className="text-fg-muted hover:text-fg-primary text-[12px]"
              title="Open in full panel"
              aria-label={`Open ${title} in popout`}
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-fg-muted hover:text-fg-primary text-[10px]"
            aria-hidden
            tabIndex={-1}
          >
            {open ? '⌃' : '⌄'}
          </button>
        </div>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ---- Plan section（KodaX Scout todo list） ----

function PlanSection(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );

  if (!todos || todos.length === 0) return null;

  const done = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const running = todos.find((t) => t.status === 'in_progress');

  return (
    <Section title={`Plan (${done}/${total})`} popoutKind="plan">
      {running?.activeForm && (
        <div className="text-[11px] text-fg-muted mb-2 truncate" title={running.activeForm}>
          → {running.activeForm}
        </div>
      )}
      <ol className="space-y-1 text-[11px]">
        {todos.map((t, idx) => (
          <li key={t.id} className="flex items-start gap-2">
            <span className="flex-shrink-0 text-fg-muted font-mono text-[10px] w-5 text-right mt-0.5 tabular-nums">
              {idx + 1}.
            </span>
            <span className="flex-shrink-0 mt-0.5" aria-hidden>
              {t.status === 'completed' ? (
                <CircleDone tiny />
              ) : t.status === 'in_progress' ? (
                <CircleActive tiny />
              ) : (
                <CircleEmpty tiny />
              )}
            </span>
            <span
              className={
                t.status === 'completed'
                  ? 'text-fg-muted line-through'
                  : t.status === 'in_progress'
                    ? 'text-fg-primary'
                    : 'text-fg-secondary'
              }
            >
              {t.content}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---- Workers section（active worker 摘要） ----

function WorkersSection(): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );

  const workers = useMemo(() => buildWorkerTree(status), [status]);

  // 无 worker 数据时不渲染 —— 跟 PlanSection 同样的"无内容隐藏"策略
  if (workers.length === 0 && !budget) return null;

  // active = 当前真在动的 worker（isActive=true 或最近有事件流入）。idle/done 不放摘要。
  const active = workers.filter((w) => w.isActive);

  return (
    <Section title={`Workers (${workers.length})`} popoutKind="tasks">
      {budget && (
        <div className="mb-2 text-[10px]">
          <div className="text-fg-secondary font-mono">
            budget {budget.used}/{budget.cap}
          </div>
          <div className="h-1 bg-surface-2 rounded overflow-hidden mt-0.5">
            <div
              className="h-full bg-emerald-600"
              style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {active.length === 0 ? (
        <div className="text-[11px] text-fg-muted">All workers idle.</div>
      ) : (
        <ul className="text-[11px] space-y-1">
          {active.slice(0, 5).map((w) => (
            <li key={w.workerId} className="flex items-center gap-1.5 truncate">
              <span className="text-emerald-400 text-[8px] flex-shrink-0" aria-hidden>●</span>
              <span className="text-fg-secondary truncate" title={w.workerTitle}>
                {w.workerTitle}
              </span>
              {w.latestPhase && (
                <span className="text-fg-muted text-[10px] flex-shrink-0" aria-hidden>
                  · {w.latestPhase}
                </span>
              )}
            </li>
          ))}
          {active.length > 5 && (
            <li className="text-fg-muted">+{active.length - 5} more — click ⤢ for full tree</li>
          )}
        </ul>
      )}
    </Section>
  );
}

// ---- Changes section（git porcelain 文件列表） ----

interface GitChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U';
  staged: boolean;
}

interface GitChangesSnapshot {
  isGitRepo: boolean;
  branch: string | null;
  files: GitChange[];
  truncated: boolean;
}

const CHANGES_REFRESH_DEBOUNCE_MS = 800;

function ChangesSection(): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const requestPopout = useAppStore((s) => s.requestPopout);

  // 监听 write/edit/bash tool_result → debounce 触发 refetch（沿用 StashNotice 同款逻辑）
  const lastToolResultMarker = useAppStore((s) => {
    if (!currentSessionId) return 0;
    const evs = s.eventsBySession[currentSessionId] ?? [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.kind === 'session_start') return 0;
      if (ev.kind !== 'tool_result') continue;
      const name = (ev as { toolName?: string }).toolName;
      if (name === 'write' || name === 'edit' || name === 'bash' || name === 'multiedit') {
        return i;
      }
    }
    return 0;
  });

  const [snapshot, setSnapshot] = useState<GitChangesSnapshot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  const fetchChanges = useCallback((path: string): void => {
    if (!window.kodaxSpace) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void window.kodaxSpace
      .invoke('project.gitChanges', { projectRoot: path })
      .then((r) => {
        if (!r.ok) return;
        // 用户切走时丢弃
        if (useAppStore.getState().currentProjectPath !== path) return;
        setSnapshot({
          isGitRepo: r.data.isGitRepo,
          branch: r.data.branch,
          files: [...r.data.files],
          truncated: r.data.truncated,
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!currentProjectPath) {
      setSnapshot(null);
      return;
    }
    fetchChanges(currentProjectPath);
  }, [currentProjectPath, fetchChanges]);

  // tool_result debounced 重读 + window focus + 30s 兜底（沿用 StashNotice 同款触发器）
  useEffect(() => {
    if (!currentProjectPath || lastToolResultMarker === 0) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchChanges(currentProjectPath), CHANGES_REFRESH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [lastToolResultMarker, currentProjectPath, fetchChanges]);

  useEffect(() => {
    if (!currentProjectPath) return;
    const refresh = (): void => fetchChanges(currentProjectPath);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [currentProjectPath, fetchChanges]);

  if (!snapshot || !snapshot.isGitRepo) {
    return null;
  }

  return (
    <Section title={`Changes (${snapshot.files.length}${snapshot.truncated ? '+' : ''})`}>
      {snapshot.branch && (
        <div className="text-[10px] text-fg-muted mb-1.5 font-mono">on {snapshot.branch}</div>
      )}
      {snapshot.files.length === 0 ? (
        <div className="text-[11px] text-fg-muted">working tree clean</div>
      ) : (
        <ul className="text-[11px] font-mono space-y-0.5">
          {snapshot.files.map((f) => (
            <li key={`${f.path}_${f.status}_${f.staged ? 'S' : 'U'}`}>
              <button
                type="button"
                onClick={() => {
                  // 把 path 塞进 lastDiffPath 让 DiffPanel 接住；同时弹 popout
                  useAppStore.getState().setLastDiffPath(f.path);
                  requestPopout('diff');
                }}
                className="w-full text-left flex items-start gap-1.5 hover:bg-hover-bg rounded px-1 py-0.5 text-fg-secondary hover:text-fg-primary"
                title={f.path}
              >
                <StatusBadge status={f.status} staged={f.staged} />
                <span className="truncate flex-1">{f.path}</span>
              </button>
            </li>
          ))}
          {snapshot.truncated && (
            <li className="text-fg-muted px-1">+ more (truncated at 200)</li>
          )}
        </ul>
      )}
    </Section>
  );
}

function StatusBadge({ status, staged }: { status: GitChange['status']; staged: boolean }): JSX.Element {
  // 颜色：staged 绿 / worktree-only 琥珀 / untracked 灰；字母 = 状态首字
  const color =
    status === 'U' ? 'text-zinc-500' : staged ? 'text-emerald-400' : 'text-amber-400';
  return (
    <span
      className={`flex-shrink-0 w-4 text-[10px] font-bold text-center ${color}`}
      title={`${status === 'U' ? 'Untracked' : status === 'M' ? 'Modified' : status === 'A' ? 'Added' : status === 'D' ? 'Deleted' : 'Renamed'}${staged ? ' (staged)' : ''}`}
      aria-hidden
    >
      {status}
    </span>
  );
}

// ---- Working folder（降级到底部） ----

function WorkingFolderSection(): JSX.Element {
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section title="Working folder" defaultOpen={false}>
      {projectPath ? (
        <div className="text-[11px] text-fg-secondary space-y-1">
          <div className="flex items-center gap-1.5">
            <span aria-hidden>📁</span>
            <span className="font-medium text-fg-primary truncate" title={projectPath}>
              {projectName}
            </span>
          </div>
          <div className="text-fg-muted text-[10px] font-mono break-all">{projectPath}</div>
        </div>
      ) : (
        <div className="text-[11px] text-fg-muted">No project open.</div>
      )}
    </Section>
  );
}

// ---- Context（降级到底部） ----

function ContextSection(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );

  const refs = useMemo(() => collectContextRefs(events), [events]);

  if (refs.tools.length === 0 && refs.files.length === 0) {
    return (
      <Section title="Context" defaultOpen={false}>
        <div className="text-[11px] text-fg-muted leading-relaxed">
          Track tools and referenced files used in this task.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Context" defaultOpen={false}>
      {refs.tools.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Tools used</div>
          <div className="flex flex-wrap gap-1">
            {refs.tools.map((t) => (
              <span
                key={t.name}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-secondary"
                title={`${t.count}× ${t.name}`}
              >
                {t.name}
                {t.count > 1 && <span className="text-fg-muted ml-0.5">×{t.count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {refs.files.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">Files referenced</div>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {refs.files.slice(0, 20).map((f) => (
              <li key={f} className="truncate text-fg-secondary" title={f}>
                {f}
              </li>
            ))}
            {refs.files.length > 20 && (
              <li className="text-fg-muted">+{refs.files.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </Section>
  );
}

interface ContextRefs {
  readonly tools: ReadonlyArray<{ name: string; count: number }>;
  readonly files: readonly string[];
}

function collectContextRefs(events: readonly SessionEvent[]): ContextRefs {
  const toolCounts = new Map<string, number>();
  const files = new Set<string>();
  for (const ev of events) {
    if (ev.kind === 'tool_start') {
      const name = (ev as { toolName?: string }).toolName;
      if (typeof name === 'string') {
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
      const input = (ev as { input?: unknown }).input;
      if (input && typeof input === 'object') {
        const path = (input as { path?: unknown; file_path?: unknown }).path
          ?? (input as { file_path?: unknown }).file_path;
        if (typeof path === 'string' && path.length > 0 && path.length < 512) {
          files.add(path);
        }
      }
    }
  }
  return {
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    files: [...files],
  };
}

// ---- 圆点 svg-free 实现 ----

function CircleDone({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3 text-[8px]' : 'w-4 h-4 text-[10px]';
  return (
    <span
      className={`${size} rounded-full bg-emerald-500/80 text-zinc-900 flex items-center justify-center font-bold`}
      aria-hidden
    >
      ✓
    </span>
  );
}
function CircleActive({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border-2 border-sky-400 bg-sky-500/30 animate-pulse`}
      aria-hidden
    />
  );
}
function CircleEmpty({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return <span className={`${size} rounded-full border border-border-default`} aria-hidden />;
}

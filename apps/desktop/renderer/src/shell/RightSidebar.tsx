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
import {
  Check,
  ChevronRight,
  Eye,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from 'lucide-react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { clampSidebarWidthPx, useAppStore } from '../store/appStore.js';
import { openFileSmart, isPreviewablePath, revealPath } from '../lib/openPath.js';
import { Caret } from '../components/Caret.js';
import { buildWorkerTree } from './popouts/worker-tree.js';
import { ArtifactsView } from '../features/artifact/ArtifactsView.js';
import { useArtifacts, useArtifactCreated } from '../features/artifact/useArtifacts.js';
import { WorkflowPanel, useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import {
  buildSidebarPlanView,
  type SidebarPlanRow,
  type SidebarTodoStatus,
} from './sidebarPlanView.js';
import { useI18n } from '../i18n/I18nProvider.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 320;
const RIGHT_SIDEBAR_WIDE_WIDTH = 720;

interface RightSidebarProps {
  /** 2026-06: 动态宽度（px）。 */
  readonly width?: number;
}

export function RightSidebar({ width }: RightSidebarProps = {}): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const { artifacts } = useArtifacts(currentSessionId);
  const requestPopout = useAppStore((s) => s.requestPopout);
  const hasArtifacts = artifacts.length > 0;
  const [tab, setTab] = useState<'overview' | 'artifact'>('overview');
  // 锁存"对话卡片点选的 artifact id"，传给 ArtifactsView——它从概览切过来时是新挂载、
  // 错过 window 事件，靠这个 prop 在挂载时认领选中。
  const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(null);

  // 切 session → 回概览（不带着上个会话的 Artifact 视图）。
  useEffect(() => {
    setTab('overview');
    setFocusedArtifactId(null);
  }, [currentSessionId]);
  // agent 新产出 artifact → 自动切到 Artifact（精确信号：reason==='created'，
  // 不被版本更新 / 删除 / 切会话误触发）。
  useArtifactCreated(currentSessionId, () => setTab('artifact'));
  // 对话里点 artifact 卡片 → 切到 Artifact tab + 锁存 id（ArtifactsView 据此选中那一份）。
  useEffect(() => {
    const onFocus = (e: Event): void => {
      setTab('artifact');
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setFocusedArtifactId(id);
    };
    window.addEventListener('kodax-space.focus-artifact', onFocus);
    return () => window.removeEventListener('kodax-space.focus-artifact', onFocus);
  }, []);

  // 产物被删空 → 强制回概览（tab 卡在 artifact 时兜底）。
  const showArtifact = hasArtifacts && tab === 'artifact';

  return (
    <aside
      data-testid="right-sidebar"
      style={width !== undefined ? { width: `${width}px` } : undefined}
      className="glass lift ix-zone border border-border-default rounded-xl overflow-hidden bg-surface flex flex-col flex-shrink-0 text-[13px]"
    >
      {/* F059c 动态右侧栏：有产物时顶部出 [概览 | Artifact] 切换；Artifact 占满整栏满高，
          不再挤在底部的 280px 小框。⤢ 展开到中间大图（full-cover，像 diff）。 */}
      <RightSidebarWidthToolbar />
      {hasArtifacts && (
        <div className="flex items-stretch border-b border-border-default flex-shrink-0">
          <SidebarTab active={!showArtifact} onClick={() => setTab('overview')}>
            {t('right.overview')}
          </SidebarTab>
          <SidebarTab active={showArtifact} onClick={() => setTab('artifact')}>
            {t('right.artifact')} ({artifacts.length})
          </SidebarTab>
          {showArtifact && (
            <button
              type="button"
              onClick={() => requestPopout('artifact')}
              title={t('right.expandArtifact')}
              aria-label={t('right.expandArtifact')}
              className="px-2.5 inline-flex items-center justify-center text-fg-muted hover:text-fg-primary hover:bg-surface-3 border-l border-border-default/60"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M15 3h6v6" />
                <path d="M10 14L21 3" />
                <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
            </button>
          )}
        </div>
      )}
      {showArtifact ? (
        <div className="flex-1 min-h-0">
          <ArtifactsView focusedId={focusedArtifactId} />
        </div>
      ) : (
        // 概览：原任务态多节堆叠（自身滚动）。
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PlanSection />
          <WorkflowSection />
          <WorkersSection />
          <ChangesSection />
          <WorkingFolderSection />
          <ContextSection />
        </div>
      )}
    </aside>
  );
}

function RightSidebarWidthToolbar(): JSX.Element {
  const { t } = useI18n();
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-default/60 px-2 py-1.5 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-fg-faint">{t('right.panel')}</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setRightSidebarWidth(RIGHT_SIDEBAR_DEFAULT_WIDTH)}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
          title={t('right.defaultWidth')}
          aria-label={t('right.defaultWidth')}
        >
          <Minimize2 size={13} strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setRightSidebarWidth(clampSidebarWidthPx(RIGHT_SIDEBAR_WIDE_WIDTH))}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
          title={t('right.wideWidth')}
          aria-label={t('right.wideWidth')}
        >
          <Maximize2 size={13} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** 右侧栏顶部的 [概览|Artifact] 分段按钮。active = 微高亮底色。 */
function SidebarTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 px-3 py-2 text-[12px] font-medium ${
        active ? 'text-fg-primary bg-surface-2' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {children}
    </button>
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
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const requestPopout = useAppStore((s) => s.requestPopout);
  // v0.1.9 fix: ⤢ 改 toggle —— 当前 popout 已经是 popoutKind 时再点关掉,否则打开。
  const activePopoutKind = useAppStore((s) => s.activePopoutKind);
  const setActivePopoutKind = useAppStore((s) => s.setActivePopoutKind);
  const isThisPopoutActive = popoutKind !== undefined && activePopoutKind === popoutKind;
  return (
    <section className="border-b border-border-default/60">
      <div className="w-full px-3 py-2 flex items-center justify-between text-xs uppercase tracking-wider text-fg-muted">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left hover:text-fg-primary flex items-center gap-1.5"
          aria-expanded={open}
        >
          <span>{title}</span>
        </button>
        {/* v0.1.9 fix: 按钮加大点击区 (w/h 22px) + 间距,换 Lucide-style SVG icon 取代
            难辨的 ⤢ / ⌃ / ⌄ Unicode 字符。activePopout 当前已经是本 kind 时 ⤢ 切到 ×
            实现"再点关闭"行为。 */}
        <div className="flex items-center gap-0.5 -mr-1">
          {popoutKind && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isThisPopoutActive) {
                  // Shell 监听 store 不太顺手关 popout (它是 useState), 这里走 setActivePopoutKind(null)
                  // + Shell.tsx 加 useEffect 监听 store 同步关。下面 Shell 改动: 双向同步。
                  setActivePopoutKind(null);
                } else {
                  requestPopout(popoutKind);
                }
              }}
              className="w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
              title={isThisPopoutActive ? t('right.closePopout') : t('right.openFullPanel')}
              aria-label={isThisPopoutActive ? t('right.closePopout') : t('right.openFullPanel')}
              aria-pressed={isThisPopoutActive}
            >
              {isThisPopoutActive ? (
                // X icon (close)
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              ) : (
                // Expand-corner icon (popout)
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-5 h-5 inline-flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-surface-3"
            title={open ? t('right.collapseSection') : t('right.expandSection')}
            aria-label={open ? t('right.collapseSection') : t('right.expandSection')}
            aria-expanded={open}
          >
            {/* 统一走 Caret（chevron-right 旋转）：collapsed 指右、expanded 朝下 */}
            <Caret open={open} />
          </button>
        </div>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ---- Plan section（KodaX Scout todo list） ----

function PlanSection(): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );

  if (!todos || todos.length === 0) return null;

  const plan = buildSidebarPlanView(todos);

  return (
    <Section title={`${t('right.plan')} (${plan.completed}/${plan.total})`} popoutKind="plan">
      {plan.running?.activeForm && (
        <div className="text-xs text-fg-muted mb-2 truncate" title={plan.running.activeForm}>
          → {plan.running.activeForm}
        </div>
      )}
      <ul className="space-y-1 text-xs">
        {plan.rows.map((row) => (
          <PlanRow key={planRowKey(row)} row={row} />
        ))}
      </ul>
    </Section>
  );
}

function planRowKey(row: SidebarPlanRow): string {
  if (row.kind === 'item') return row.item.id;
  return `${row.kind}:${row.count}`;
}

function PlanRow({ row }: { row: SidebarPlanRow }): JSX.Element {
  if (row.kind === 'done-summary') {
    return (
      <li className="flex items-center gap-2 px-1.5 py-0.5 text-[11px] font-mono text-fg-faint">
        <span className="w-3 text-center text-ok" aria-hidden>
          ✓
        </span>
        <span>{row.count} done</span>
      </li>
    );
  }

  if (row.kind === 'more-summary') {
    return (
      <li className="flex items-center gap-2 px-1.5 py-0.5 text-[11px] font-mono text-fg-faint">
        <span className="w-3 text-center" aria-hidden>
          +
        </span>
        <span>{row.count} more</span>
      </li>
    );
  }

  const { item } = row;
  return (
    <li
      className={`flex items-start gap-2 rounded px-1.5 py-1 ${
        item.status === 'in_progress' ? 'bg-run/25' : ''
      }`}
    >
      <span
        className="flex-shrink-0 mt-0.5"
        title={item.status}
        aria-label={`status: ${item.status}`}
      >
        <PlanStatusIcon status={item.status} />
      </span>
      <span
        className={`min-w-0 flex-1 leading-snug break-words ${planTodoTextClass(item.status)}`}
        title={item.content}
      >
        {item.content}
      </span>
    </li>
  );
}

function PlanStatusIcon({ status }: { status: SidebarTodoStatus }): JSX.Element {
  switch (status) {
    case 'completed':
      return <CircleDone tiny />;
    case 'in_progress':
      return <CircleActive tiny />;
    case 'failed':
      return <CircleFailed tiny />;
    case 'skipped':
    case 'cancelled':
      return <CircleMuted tiny />;
    case 'pending':
      return <CircleEmpty tiny />;
  }
}

function planTodoTextClass(status: SidebarTodoStatus): string {
  switch (status) {
    case 'completed':
      return 'text-fg-muted';
    case 'in_progress':
      return 'text-fg-primary font-medium';
    case 'failed':
      return 'text-danger font-medium';
    case 'skipped':
    case 'cancelled':
      return 'text-fg-muted line-through';
    case 'pending':
      return 'text-fg-secondary';
  }
}

// ---- Workers section（active worker 摘要） ----

// F061 Workflow 进度 Section（Coder-only —— RightSidebar 本就只挂 code surface）。
// 无归属当前 session 的工作流 run 时整段隐藏；有历史 run 时保留最近一次终态，
// 避免 workflow 刚完成右栏突然消失，用户无法回看流程图 / 子 agent 状态。
function WorkflowSection(): JSX.Element | null {
  const { t } = useI18n();
  const runs = useSessionWorkflowRuns();
  const currentRun =
    runs.find((run) => run.status === 'running' || run.status === 'paused') ?? runs[0];
  if (!currentRun) return null;
  return (
    <Section title={t('right.workflow')} popoutKind="workflow">
      <WorkflowPanel runs={[currentRun]} variant="compact" />
    </Section>
  );
}

function WorkersSection(): JSX.Element | null {
  const { t } = useI18n();
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
    <Section
      title={`${t('right.workers')} (${workers.length})`}
      defaultOpen={false}
      popoutKind="tasks"
    >
      {budget && (
        <div className="mb-2 text-[11px]">
          <div className="text-fg-secondary font-mono">
            budget {budget.used}/{budget.cap}
          </div>
          <div className="h-1 bg-surface-3 rounded overflow-hidden mt-0.5">
            <div
              className="h-full bg-ok"
              style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {active.length === 0 ? (
        <div className="text-xs text-fg-muted">All workers idle.</div>
      ) : (
        <ul className="text-xs space-y-1">
          {active.slice(0, 5).map((w) => (
            <li key={w.workerId} className="flex items-center gap-1.5 truncate">
              <span
                className="w-1.5 h-1.5 rounded-full bg-run flex-shrink-0 animate-pulse"
                aria-hidden
              />
              <span className="text-fg-secondary truncate" title={w.workerTitle}>
                {w.workerTitle}
              </span>
              {w.latestPhase && (
                <span className="text-fg-muted text-[11px] flex-shrink-0" aria-hidden>
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
  const { t } = useI18n();
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

  // F054: 改动量大时按目录树折叠。collapsed = 已折叠目录的 path 集合（默认全展开）。
  // 跨 refetch 持久（keyed by dir path），30s 刷新不会重置用户的折叠态。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleDir = useCallback((dirPath: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);
  const pickFile = useCallback(
    (filePath: string): void => {
      useAppStore.getState().setLastDiffPath(filePath);
      requestPopout('diff');
    },
    [requestPopout],
  );
  const tree = useMemo(() => buildChangeTree(snapshot?.files ?? []), [snapshot?.files]);

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
    debounceRef.current = setTimeout(
      () => fetchChanges(currentProjectPath),
      CHANGES_REFRESH_DEBOUNCE_MS,
    );
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
    <Section
      title={`${t('right.changes')} (${snapshot.files.length}${snapshot.truncated ? '+' : ''})`}
    >
      {snapshot.branch && (
        <div className="text-[11px] text-fg-muted mb-1.5 font-mono">on {snapshot.branch}</div>
      )}
      {snapshot.files.length === 0 ? (
        <div className="text-xs text-fg-muted">working tree clean</div>
      ) : (
        <ul className="text-xs font-mono space-y-0.5">
          <ChangeTreeView
            node={tree}
            depth={0}
            collapsed={collapsed}
            onToggle={toggleDir}
            onPick={pickFile}
          />
          {snapshot.truncated && <li className="text-fg-muted px-1">+ more (truncated at 200)</li>}
        </ul>
      )}
    </Section>
  );
}

// ---- Changes 目录树（F054：改动量大时按目录折叠，含单链目录压缩）----

interface ChangeTreeNode {
  /** 显示用段名（压缩后可能是 "a/b/c"）。root 为空串。 */
  name: string;
  /** 目录全路径（折叠状态的 key）。 */
  path: string;
  dirs: ChangeTreeNode[];
  files: GitChange[];
  /** 该子树下变动文件总数。 */
  count: number;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * 把扁平文件列表建成目录树。两步：
 *   1) 按 '/' 分段建嵌套目录 + 把文件挂到所在目录
 *   2) finalize：算 count、排序、压缩单链目录（无文件且仅 1 子目录 → 并成 "a/b/c"，VS Code 同款）
 */
function buildChangeTree(files: readonly GitChange[]): ChangeTreeNode {
  const root: ChangeTreeNode = { name: '', path: '', dirs: [], files: [], count: 0 };
  const dirMap = new Map<string, ChangeTreeNode>([['', root]]);

  function ensureDir(dirPath: string): ChangeTreeNode {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf('/');
    const parentPath = slash >= 0 ? dirPath.slice(0, slash) : '';
    const name = slash >= 0 ? dirPath.slice(slash + 1) : dirPath;
    const parent = ensureDir(parentPath);
    const node: ChangeTreeNode = { name, path: dirPath, dirs: [], files: [], count: 0 };
    parent.dirs.push(node);
    dirMap.set(dirPath, node);
    return node;
  }

  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const dirPath = slash >= 0 ? f.path.slice(0, slash) : '';
    ensureDir(dirPath).files.push(f);
  }

  function finalize(node: ChangeTreeNode): number {
    let c = node.files.length;
    for (const d of node.dirs) c += finalize(d);
    node.count = c;
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
    // 压缩单链：无直属文件且仅 1 子目录的节点与子合并
    node.dirs = node.dirs.map((d) => {
      let cur = d;
      while (cur.files.length === 0 && cur.dirs.length === 1) {
        const child = cur.dirs[0];
        cur = {
          name: `${cur.name}/${child.name}`,
          path: child.path,
          dirs: child.dirs,
          files: child.files,
          count: child.count,
        };
      }
      return cur;
    });
    return c;
  }
  finalize(root);
  return root;
}

interface ChangeTreeViewProps {
  node: ChangeTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (dirPath: string) => void;
  onPick: (filePath: string) => void;
}

/** 递归渲染目录树：目录行可折叠（chevron + folder + count），文件行 → 点开 diff。 */
function ChangeTreeView({
  node,
  depth,
  collapsed,
  onToggle,
  onPick,
}: ChangeTreeViewProps): JSX.Element {
  const pad = (d: number): React.CSSProperties => ({ paddingLeft: `${d * 11 + 4}px` });
  return (
    <>
      {node.dirs.map((d) => {
        const isCollapsed = collapsed.has(d.path);
        return (
          <li key={`d:${d.path}`}>
            <button
              type="button"
              onClick={() => onToggle(d.path)}
              style={pad(depth)}
              className="w-full text-left flex items-center gap-1 pr-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
              aria-expanded={!isCollapsed}
              title={d.path}
            >
              <ChevronRight
                className={`w-3 h-3 flex-shrink-0 text-fg-faint transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                strokeWidth={2}
              />
              <Folder className="w-3 h-3 flex-shrink-0 text-fg-muted" strokeWidth={1.75} />
              <span className="truncate flex-1">{d.name}</span>
              <span className="text-fg-faint tabular-nums">{d.count}</span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-0.5">
                <ChangeTreeView
                  node={d}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onPick={onPick}
                />
              </ul>
            )}
          </li>
        );
      })}
      {node.files.map((f) => (
        <li key={`f:${f.path}_${f.status}_${f.staged ? 'S' : 'U'}`}>
          <button
            type="button"
            onClick={() => onPick(f.path)}
            style={pad(depth)}
            className="w-full text-left flex items-center gap-1.5 pr-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
            title={f.path}
          >
            <StatusBadge status={f.status} staged={f.staged} />
            <span className="truncate flex-1">{basename(f.path)}</span>
          </button>
        </li>
      ))}
    </>
  );
}

function StatusBadge({
  status,
  staged,
}: {
  status: GitChange['status'];
  staged: boolean;
}): JSX.Element {
  // 颜色：staged 绿 / worktree-only 琥珀 / untracked 灰；字母 = 状态首字
  const color = status === 'U' ? 'text-fg-muted' : staged ? 'text-ok' : 'text-warn';
  return (
    <span
      className={`flex-shrink-0 w-4 text-[11px] font-bold text-center ${color}`}
      title={`${status === 'U' ? 'Untracked' : status === 'M' ? 'Modified' : status === 'A' ? 'Added' : status === 'D' ? 'Deleted' : 'Renamed'}${staged ? ' (staged)' : ''}`}
      aria-hidden
    >
      {status}
    </span>
  );
}

// ---- Working folder（降级到底部） ----

function WorkingFolderSection(): JSX.Element {
  const { t } = useI18n();
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section title={t('right.workingFolder')} defaultOpen={false}>
      {projectPath ? (
        <div className="text-xs text-fg-secondary space-y-1">
          <div className="flex items-center gap-1.5">
            <Folder
              className="w-3.5 h-3.5 text-accent-ink flex-shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="font-medium text-fg-primary truncate" title={projectPath}>
              {projectName}
            </span>
          </div>
          {/* 2026-06-18: 工作目录路径可点击 → 在文件管理器中定位（同"路径不再是死文本"主旨）。 */}
          <button
            type="button"
            onClick={() => void revealPath(projectPath)}
            title="在文件管理器中显示"
            className="group/wf w-full text-left flex items-start gap-1 text-fg-muted text-[11px] font-mono break-all hover:text-fg-secondary"
          >
            <span className="break-all">{projectPath}</span>
            <FolderOpen
              className="w-3 h-3 mt-0.5 flex-shrink-0 text-fg-faint opacity-0 group-hover/wf:opacity-100"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>
      ) : (
        <div className="text-xs text-fg-muted">No project open.</div>
      )}
    </Section>
  );
}

// ---- Context（降级到底部） ----

function ContextSection(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );

  const refs = useMemo(() => collectContextRefs(events), [events]);

  if (refs.tools.length === 0 && refs.files.length === 0) {
    return (
      <Section title={t('right.context')} defaultOpen={false}>
        <div className="text-xs text-fg-muted leading-relaxed">
          Track tools and referenced files used in this task.
        </div>
      </Section>
    );
  }

  return (
    <Section title={t('right.context')} defaultOpen={false}>
      {refs.tools.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1">Tools used</div>
          <div className="flex flex-wrap gap-1">
            {refs.tools.map((t) => (
              <span
                key={t.name}
                className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-secondary"
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
          <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1">
            Files referenced
          </div>
          <ul className="space-y-0.5 text-xs font-mono">
            {refs.files.slice(0, 20).map((f) => {
              const previewable = isPreviewablePath(f);
              return (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => void openFileSmart(f)}
                    className="group/ctxfile w-full text-left flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-hover-bg text-fg-secondary hover:text-fg-primary"
                    title={previewable ? `预览 ${f}` : `在文件管理器中显示 ${f}`}
                  >
                    <span className="truncate flex-1">{f}</span>
                    {previewable ? (
                      <Eye
                        className="w-3 h-3 flex-shrink-0 text-fg-faint opacity-0 group-hover/ctxfile:opacity-100"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    ) : (
                      <FolderOpen
                        className="w-3 h-3 flex-shrink-0 text-fg-faint opacity-0 group-hover/ctxfile:opacity-100"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {refs.files.length > 20 && (
              <li className="text-fg-muted px-1">+{refs.files.length - 20} more</li>
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
        const path =
          (input as { path?: unknown; file_path?: unknown }).path ??
          (input as { file_path?: unknown }).file_path;
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
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full bg-ok text-white flex items-center justify-center`}
      aria-hidden
    >
      <Check className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={3.5} />
    </span>
  );
}
function CircleActive({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border-2 border-run bg-run/30 animate-pulse`}
      aria-hidden
    />
  );
}
function CircleEmpty({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return <span className={`${size} rounded-full border border-border-default`} aria-hidden />;
}

function CircleFailed({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full bg-danger text-white flex items-center justify-center`}
      aria-hidden
    >
      <X className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={3.25} />
    </span>
  );
}

function CircleMuted({ tiny = true }: { tiny?: boolean } = {}): JSX.Element {
  const size = tiny ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <span
      className={`${size} rounded-full border border-border-strong text-fg-faint flex items-center justify-center`}
      aria-hidden
    >
      <Minus className={tiny ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={2.5} />
    </span>
  );
}

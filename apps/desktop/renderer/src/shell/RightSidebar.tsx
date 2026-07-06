// RightSidebar 鈥?F041 (v0.1.4) "浠诲姟鎬?mission control"
//
// 閲嶅鍓嶏細Progress / Working folder / Context 涓夎妭锛孭rogress 涓?PlanPanel popout 閲嶅娓叉煋鍚屼竴浠?todoList銆?
// 閲嶅鍚庯細Plan / Workers / Changes 涓夎妭甯搁┗锛堥粯璁ゅ睍寮€锛? Working folder / Context 闄嶇骇鍒板簳閮紙榛樿鎶樺彔锛夈€?
// 閫€褰?StashNotice 妯箙锛堣鏁扮増"鈼?Uncommitted: N modified..."锛夛紝鍏惰亴璐ｇ敱 Changes 鑺傛枃浠跺垪琛ㄤ笂浣嶆浛浠ｃ€?
//
// 鏁版嵁婧愶細
//   - Plan:    todoListBySession锛堝悓 PlanPanel popout 鍗曚竴鏉ユ簮锛屽垹闄ゅ師 ProgressSection 閲嶅锛?
//   - Workers: managedTaskStatusBySession + buildWorkerTree锛堝悓 TasksPanel popout 鍗曚竴鏉ユ簮锛?
//   - Changes: project.gitChanges IPC锛堟柊澧烇紝F041 鍔狅紱鍚屾 5s TTL cache + 200 鏂囦欢涓婇檺锛?
//   - Working folder: currentProjectPath
//   - Context:        eventsBySession[sid].tool_start 鎶曞奖
//
// 姣忚妭鏍囬鍙充晶鐨?猡?鎸夐挳 鈫?鍚屾閫氱煡 Shell 鍒?popout锛岀湅瀹屾暣缁嗚妭銆侾lan/Workers/Diff overlays 澶嶇敤銆?
//
// CommandToolbar 鐨?POPOUTS 绉婚櫎浜?tasks / plan锛堥伩鍏嶄袱涓叆鍙ｉ噸澶嶈Е鍙?PlanPanel / TasksPanel锛夛紱
// Diff / Preview / Terminal / Agents / MCP 淇濈暀銆?

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Eye,
  Folder,
  FolderOpen,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { clampSidebarWidthPx, useAppStore } from '../store/appStore.js';
import { openFileSmart, isPreviewablePath, revealPath } from '../lib/openPath.js';
import { Caret } from '../components/Caret.js';
import { ArtifactsView } from '../features/artifact/ArtifactsView.js';
import { useArtifacts, useArtifactCreated } from '../features/artifact/useArtifacts.js';
import { useTranscriptArtifacts } from '../features/artifact/useTranscriptArtifacts.js';
import {
  FOCUS_ARTIFACT_EVENT,
  type FocusArtifactEventDetail,
  type TransientArtifactSnapshot,
} from '../features/artifact/transientArtifact.js';
import { WorkflowPanel, useSessionWorkflowRuns } from '../features/workflow/WorkflowPanel.js';
import {
  buildSidebarPlanView,
  type SidebarPlanRow,
  type SidebarTodoStatus,
} from './sidebarPlanView.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { requestShellPopout } from './popoutControl.js';
import type { PopoutKind } from './CommandToolbar.js';
import {
  TASK_DOCK_FOCUS_EVENT,
  type TaskDockFocusState,
  type TaskDockFocusRequest,
  type TaskDockSectionId,
} from './taskDockControl.js';
import { buildAgentStatuses, type AgentStatusViewModel } from './agentStatusProjection.js';
import { buildTaskDockRunView } from './taskDockProjection.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];

interface RightSidebarProps {
  /** 2026-06: 鍔ㄦ€佸搴︼紙px锛夈€?*/
  readonly width?: number;
  readonly defaultWidth?: number;
  readonly expandedWidth?: number;
  readonly shellFocusRequest?: TaskDockFocusState;
}

export function RightSidebar({
  width,
  defaultWidth = 320,
  expandedWidth = 320,
  shellFocusRequest,
}: RightSidebarProps = {}): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const { artifacts, error: artifactError } = useArtifacts(currentSessionId);
  const transcriptArtifacts = useTranscriptArtifacts(currentSessionId);
  const hasArtifacts = artifacts.length > 0;
  const hasTranscriptArtifacts = transcriptArtifacts.length > 0;
  const artifactCount = hasArtifacts ? artifacts.length : transcriptArtifacts.length;
  const [tab, setTab] = useState<'overview' | 'artifact'>('overview');
  const hasArtifactSurface =
    hasArtifacts || hasTranscriptArtifacts || artifactError !== null || tab === 'artifact';
  const [focusedArtifactSnapshot, setFocusedArtifactSnapshot] =
    useState<TransientArtifactSnapshot | null>(null);
  // 閿佸瓨"瀵硅瘽鍗＄墖鐐归€夌殑 artifact id"锛屼紶缁?ArtifactsView鈥斺€斿畠浠庢瑙堝垏杩囨潵鏃舵槸鏂版寕杞姐€?
  // 閿欒繃 window 浜嬩欢锛岄潬杩欎釜 prop 鍦ㄦ寕杞芥椂璁ら閫変腑銆?
  const [focusedArtifactId, setFocusedArtifactId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<TaskDockFocusState>({
    section: null,
    nonce: 0,
  });

  useEffect(() => {
    const onFocus = (event: Event): void => {
      const section = (event as CustomEvent<TaskDockFocusRequest>).detail?.section;
      if (!section) return;
      setTab(section === 'artifacts' ? 'artifact' : 'overview');
      setFocusRequest((current) => ({ section, nonce: current.nonce + 1 }));
    };
    window.addEventListener(TASK_DOCK_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(TASK_DOCK_FOCUS_EVENT, onFocus);
  }, []);

  const effectiveFocusRequest =
    shellFocusRequest && shellFocusRequest.nonce > focusRequest.nonce
      ? shellFocusRequest
      : focusRequest;

  // 鍒?session 鈫?鍥炴瑙堬紙涓嶅甫鐫€涓婁釜浼氳瘽鐨?Artifact 瑙嗗浘锛夈€?
  useEffect(() => {
    setTab('overview');
    setFocusedArtifactId(null);
    setFocusedArtifactSnapshot(null);
  }, [currentSessionId]);
  useEffect(() => {
    if (!hasArtifacts && hasTranscriptArtifacts) setTab('artifact');
  }, [hasArtifacts, hasTranscriptArtifacts, currentSessionId]);
  // agent 鏂颁骇鍑?artifact 鈫?鑷姩鍒囧埌 Artifact锛堢簿纭俊鍙凤細reason==='created'锛?
  // 涓嶈鐗堟湰鏇存柊 / 鍒犻櫎 / 鍒囦細璇濊瑙﹀彂锛夈€?
  useArtifactCreated(currentSessionId, () => setTab('artifact'));
  // 瀵硅瘽閲岀偣 artifact 鍗＄墖 鈫?鍒囧埌 Artifact tab + 閿佸瓨 id锛圓rtifactsView 鎹閫変腑閭ｄ竴浠斤級銆?
  useEffect(() => {
    const onFocus = (e: Event): void => {
      setTab('artifact');
      const detail = (e as CustomEvent<FocusArtifactEventDetail>).detail;
      const id = detail?.id;
      if (id) setFocusedArtifactId(id);
      setFocusedArtifactSnapshot(detail?.snapshot ?? null);
    };
    window.addEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_ARTIFACT_EVENT, onFocus);
  }, []);

  // 浜х墿琚垹绌?鈫?寮哄埗鍥炴瑙堬紙tab 鍗″湪 artifact 鏃跺厹搴曪級銆?
  const showArtifact = hasArtifactSurface && tab === 'artifact';

  return (
    <aside
      data-testid="right-sidebar"
      data-dock-kind="task-dock"
      style={width !== undefined ? { width: `${width}px` } : undefined}
      className="glass lift ix-zone border border-border-default rounded-xl overflow-hidden bg-surface flex flex-col flex-shrink-0 text-[13px]"
    >
      {/* F059c 鍔ㄦ€佸彸渚ф爮锛氭湁浜х墿鏃堕《閮ㄥ嚭 [姒傝 | Artifact] 鍒囨崲锛汚rtifact 鍗犳弧鏁存爮婊￠珮锛?
          涓嶅啀鎸ゅ湪搴曢儴鐨?280px 灏忔銆傗あ 灞曞紑鍒颁腑闂村ぇ鍥撅紙full-cover锛屽儚 diff锛夈€?*/}
      <RightSidebarWidthToolbar
        width={width}
        defaultWidth={defaultWidth}
        expandedWidth={expandedWidth}
      />
      {hasArtifactSurface && (
        <div className="flex items-stretch border-b border-border-default flex-shrink-0">
          <SidebarTab active={!showArtifact} onClick={() => setTab('overview')}>
            {t('right.overview')}
          </SidebarTab>
          <SidebarTab active={showArtifact} onClick={() => setTab('artifact')}>
            {t('right.artifact')}{' '}
            {artifactCount > 0 ? `(${artifactCount})` : artifactError ? '(!)' : ''}
          </SidebarTab>
          {showArtifact && (
            <button
              type="button"
              onClick={() => requestShellPopout('artifact')}
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
          <ArtifactsView focusedId={focusedArtifactId} focusedSnapshot={focusedArtifactSnapshot} />
        </div>
      ) : (
        // 姒傝锛氬師浠诲姟鎬佸鑺傚爢鍙狅紙鑷韩婊氬姩锛夈€?
        <div className="flex-1 min-h-0 overflow-y-auto">
          <RunSection focusRequest={effectiveFocusRequest} />
          <PlanSection focusRequest={effectiveFocusRequest} />
          <AgentSection focusRequest={effectiveFocusRequest} />
          <WorkflowSection focusRequest={effectiveFocusRequest} />
          <ChangesSection focusRequest={effectiveFocusRequest} />
          <SourcesSection focusRequest={effectiveFocusRequest} />
          <ArtifactsSummarySection
            focusRequest={effectiveFocusRequest}
            artifactCount={artifactCount}
            hasArtifactSurface={hasArtifactSurface}
            artifactError={artifactError}
            onOpenArtifact={() => setTab('artifact')}
          />
          <ContextSection focusRequest={effectiveFocusRequest} />
        </div>
      )}
    </aside>
  );
}

function RightSidebarWidthToolbar({
  width,
  defaultWidth,
  expandedWidth,
}: {
  readonly width?: number;
  readonly defaultWidth: number;
  readonly expandedWidth: number;
}): JSX.Element {
  const { t } = useI18n();
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  const effectiveDefaultWidth = Math.min(clampSidebarWidthPx(defaultWidth), expandedWidth);
  const currentWidth = width ?? effectiveDefaultWidth;
  const hasRoomToExpand = expandedWidth > effectiveDefaultWidth + 8;
  const isExpanded = hasRoomToExpand && currentWidth >= (effectiveDefaultWidth + expandedWidth) / 2;
  const isAtDefaultWidth = Math.abs(currentWidth - effectiveDefaultWidth) <= 8;
  const shouldRestore = isExpanded || !hasRoomToExpand;
  const Icon = shouldRestore ? PanelRightClose : PanelRightOpen;
  const label = shouldRestore ? t('right.restoreDefaultWidth') : t('right.expandWidth');
  const disabled = !hasRoomToExpand && isAtDefaultWidth;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-default/60 px-2 py-1.5 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-fg-faint">{t('right.panel')}</span>
      <button
        type="button"
        onClick={() => setRightSidebarWidth(shouldRestore ? effectiveDefaultWidth : expandedWidth)}
        disabled={disabled}
        className={`w-6 h-6 inline-flex items-center justify-center rounded hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-35 ${
          isExpanded ? 'text-fg-primary' : 'text-fg-muted hover:text-fg-primary'
        }`}
        title={label}
        aria-label={label}
        aria-pressed={isExpanded}
      >
        <Icon size={13} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

/** 鍙充晶鏍忛《閮ㄧ殑 [姒傝|Artifact] 鍒嗘鎸夐挳銆俛ctive = 寰珮浜簳鑹层€?*/
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

// ---- Section 瀹瑰櫒 ----

interface SectionProps {
  title: string;
  sectionId?: TaskDockSectionId;
  focusRequest?: TaskDockFocusState;
  defaultOpen?: boolean;
  /** F041: 璁句簡鐨勮瘽 header 鍙充晶鏄剧ず `猡 鎸夐挳锛岀偣鍑诲悓姝ユ墦寮€/鍏抽棴瀵瑰簲 popout銆?*/
  popoutKind?: PopoutKind;
  children: React.ReactNode;
}

function Section({
  title,
  sectionId,
  focusRequest,
  defaultOpen = true,
  popoutKind,
  children,
}: SectionProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLElement | null>(null);
  // v0.1.9 fix: 猡?鏀?toggle 鈥斺€?褰撳墠 popout 宸茬粡鏄?popoutKind 鏃跺啀鐐瑰叧鎺?鍚﹀垯鎵撳紑銆?
  const activePopoutKind = useAppStore((s) => s.activePopoutKind);
  const isThisPopoutActive = popoutKind !== undefined && activePopoutKind === popoutKind;

  useEffect(() => {
    if (!sectionId || focusRequest?.section !== sectionId) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest?.nonce, focusRequest?.section, sectionId]);

  return (
    <section
      ref={ref}
      className="border-b border-border-default/60"
      data-testid={popoutKind ? `right-sidebar-section-${popoutKind}` : undefined}
      data-task-dock-section={sectionId}
    >
      <div className="w-full px-3 py-2 flex items-center justify-between text-xs uppercase tracking-wider text-fg-muted">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left hover:text-fg-primary flex items-center gap-1.5"
          aria-expanded={open}
        >
          <span>{title}</span>
        </button>
        {/* v0.1.9 fix: 鎸夐挳鍔犲ぇ鐐瑰嚮鍖?(w/h 22px) + 闂磋窛,鎹?Lucide-style SVG icon 鍙栦唬
            闅捐鲸鐨?猡?/ 鈱?/ 鈱?Unicode 瀛楃銆俛ctivePopout 褰撳墠宸茬粡鏄湰 kind 鏃?猡?鍒囧埌 脳
            瀹炵幇"鍐嶇偣鍏抽棴"琛屼负銆?*/}
        <div className="flex items-center gap-0.5 -mr-1">
          {popoutKind && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isThisPopoutActive) {
                  requestShellPopout(null);
                } else {
                  requestShellPopout(popoutKind);
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
            {/* 缁熶竴璧?Caret锛坈hevron-right 鏃嬭浆锛夛細collapsed 鎸囧彸銆乪xpanded 鏈濅笅 */}
            <Caret open={open} />
          </button>
        </div>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

// ---- Plan section锛圞odaX Scout todo list锛?----

function RunSection({ focusRequest }: { readonly focusRequest: TaskDockFocusState }): JSX.Element {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const pendingSend = useAppStore((s) =>
    currentSessionId ? (s.pendingSendBySession[currentSessionId] ?? false) : false,
  );
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );
  const hasPermissionRequest = useAppStore((s) =>
    currentSessionId
      ? s.permissionQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const hasAskUserRequest = useAppStore((s) =>
    currentSessionId
      ? s.askUserQueue.some((request) => request.sessionId === currentSessionId)
      : false,
  );
  const workflowRuns = useSessionWorkflowRuns();

  const view = buildTaskDockRunView({
    hasProject: currentProjectPath !== null,
    hasSession: currentSessionId !== null,
    pendingSend,
    todos,
    managedStatus: status,
    workflowRuns,
    events,
    budget,
    hasPermissionRequest,
    hasAskUserRequest,
  });

  return (
    <Section title="Run" sectionId="run" focusRequest={focusRequest}>
      <div
        className={`rounded-lg border px-2.5 py-2 ${runCardClass(view.severity)}`}
        data-testid="task-dock-run-summary"
      >
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 rounded-full ${runDotClass(view.severity)}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg-primary" title={view.headline}>
              {view.headline}
            </div>
            {view.detail && (
              <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-fg-muted">
                {view.detail}
              </div>
            )}
          </div>
        </div>
        {view.metrics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {view.metrics.map((metric) => (
              <span
                key={metric.label}
                className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-secondary"
              >
                <span className="text-fg-faint">{metric.label}</span>{' '}
                <span className="font-mono text-fg-primary">{metric.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function runCardClass(severity: ReturnType<typeof buildTaskDockRunView>['severity']): string {
  switch (severity) {
    case 'running':
      return 'border-run/40 bg-run/10';
    case 'warning':
      return 'border-warn/40 bg-warn/10';
    case 'danger':
      return 'border-danger/40 bg-danger/10';
    case 'success':
      return 'border-ok/40 bg-ok/10';
    case 'info':
      return 'border-border-default bg-surface-2';
    case 'neutral':
      return 'border-border-default bg-surface-2';
  }
}

function runDotClass(severity: ReturnType<typeof buildTaskDockRunView>['severity']): string {
  switch (severity) {
    case 'running':
      return 'bg-run animate-pulse';
    case 'warning':
      return 'bg-warn';
    case 'danger':
      return 'bg-danger';
    case 'success':
      return 'bg-ok';
    case 'info':
      return 'bg-accent-ink';
    case 'neutral':
      return 'bg-fg-faint';
  }
}

function PlanSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );

  if (!todos || todos.length === 0) return null;

  const plan = buildSidebarPlanView(todos);

  return (
    <Section
      title={`${t('right.plan')} (${plan.completed}/${plan.total})`}
      sectionId="plan"
      focusRequest={focusRequest}
      popoutKind="plan"
    >
      {plan.running?.activeForm && (
        <div className="text-xs text-fg-muted mb-2 truncate" title={plan.running.activeForm}>
          Now: {plan.running.activeForm}
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
          <Check className="inline h-2.5 w-2.5" strokeWidth={3} />
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

// ---- Workers section锛坅ctive worker 鎽樿锛?----

// F061 Workflow 杩涘害 Section锛圕oder-only 鈥斺€?RightSidebar 鏈氨鍙寕 code surface锛夈€?
// 鏃犲綊灞炲綋鍓?session 鐨勫伐浣滄祦 run 鏃舵暣娈甸殣钘忥紱鏈夊巻鍙?run 鏃朵繚鐣欐渶杩戜竴娆＄粓鎬侊紝
// 閬垮厤 workflow 鍒氬畬鎴愬彸鏍忕獊鐒舵秷澶憋紝鐢ㄦ埛鏃犳硶鍥炵湅娴佺▼鍥?/ 瀛?agent 鐘舵€併€?
function WorkflowSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const runs = useSessionWorkflowRuns();
  // 鐢ㄦ埛鍙嶉锛歸orkflow 澶辫触鍚庝慨澶嶉噸璺戯紝鍙虫爮杩樻寕鐫€閭ｆ潯澶辫触鐨勬棫 run锛屽拰姝ｅ湪璺戠殑鍚屽悕鏂?run 娣峰湪
  // 涓€璧峰垎涓嶆竻鍝釜鏄綋鍓嶇殑銆傚彸鏍忓彧鍏冲績"姝ｅ湪杩涜"锛氬彧瑕佹湁 active锛坮unning/paused锛塺un锛屽氨**鍙?*
  // 鏄剧ず active锛屾妸缁堟€侊紙completed/failed/cancelled锛夋棫 run 鏀惰捣鈥斺€斿巻鍙蹭粛鍙湪 workflow popout
  // 锛圵orkflowPanelConnected 璧板叏閲?useSessionWorkflowRuns锛夐噷鍥炵湅娴佺▼鍥?缁撴灉銆?
  //
  // 瀹屽叏娌℃湁 active 鏃朵繚鐣欐渶杩戜竴娆＄粓鎬?run 涓€鏉♀€斺€旈伩鍏?workflow 涓€缁撴潫鍙虫爮鏁存娑堝け銆佺敤鎴锋潵涓嶅強
  // 鍥炵湅鍒氳窇瀹岀殑缁撴灉锛?15 淇濈暀缁堟€佺殑鍒濊》锛夈€俽uns 宸叉寜 startedAt 鍊掑簭锛孾0] 鍗虫渶杩戜竴娆°€?
  const displayRuns = useMemo(() => {
    const active = runs.filter((run) => run.status === 'running' || run.status === 'paused');
    return active.length > 0 ? active : runs.slice(0, 1);
  }, [runs]);
  if (displayRuns.length === 0) return null;
  const title =
    displayRuns.length > 1 ? `${t('right.workflow')} (${displayRuns.length})` : t('right.workflow');
  return (
    <Section title={title} sectionId="workflow" focusRequest={focusRequest} popoutKind="workflow">
      <WorkflowPanel runs={displayRuns} variant="compact" />
    </Section>
  );
}

function AgentSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const status = useAppStore((s) =>
    currentSessionId ? s.managedTaskStatusBySession[currentSessionId] : undefined,
  );
  const budget = useAppStore((s) =>
    currentSessionId ? s.workBudgetBySession[currentSessionId] : undefined,
  );

  const agents = useMemo(() => buildAgentStatuses(status), [status]);

  // 鏃?worker 鏁版嵁鏃朵笉娓叉煋 鈥斺€?璺?PlanSection 鍚屾牱鐨?鏃犲唴瀹归殣钘?绛栫暐
  if (agents.length === 0 && !budget) return null;

  // active = 褰撳墠鐪熷湪鍔ㄧ殑 worker锛坕sActive=true 鎴栨渶杩戞湁浜嬩欢娴佸叆锛夈€俰dle/done 涓嶆斁鎽樿銆?
  const runningCount = agents.filter((agent) => agent.state === 'active').length;
  const waitingCount = agents.filter((agent) => agent.state === 'waiting').length;
  const completedCount = agents.filter((agent) => agent.state === 'completed').length;
  // #7 fix: 涔嬪墠"active.length===0 鈫?All workers idle"娌＄湅 idleWaiting(绛夊緟瀛愮粨鏋?瀹℃壒,
  // 涓嶆槸鐪熼棽) / childFanoutCount(鍒?fan-out,worker-tree 鍙兘杩樻病浣撶幇鍑烘潵) /
  // budgetApprovalRequired(鍗″湪棰勭畻瀹℃壒) 杩欏嚑涓?TasksPanel 宸叉湁鐨勪俊鍙凤紝瀵艰嚧杩欏嚑绉?杩涜涓絾
  // 鏆傛棤 active worker"鐨勭姸鎬佽绱у噾瑙嗗浘璇樉绀烘垚涓€鐗囩┖闂层€傝繖閲岄暅鍍?TasksPanel 鐨勫垽鏂『搴忋€?
  const fanoutLabel =
    status?.childFanoutCount !== undefined && status.childFanoutCount > 0
      ? `${status.childFanoutCount} active${status.childFanoutClass ? ` / ${status.childFanoutClass}` : ''}`
      : null;

  return (
    <Section
      title={`Agents (${agents.length})`}
      sectionId="agents"
      focusRequest={focusRequest}
      defaultOpen={false}
      popoutKind="tasks"
    >
      {budget && (
        <div className="mb-2 text-[11px]">
          <div className="text-fg-secondary font-mono">
            budget {budget.used}/{budget.cap}
            {status?.budgetApprovalRequired && (
              <span className="ml-2 text-warn">/ approval needed</span>
            )}
          </div>
          <div className="h-1 bg-surface-3 rounded overflow-hidden mt-0.5">
            <div
              className="h-full bg-ok"
              style={{ width: `${Math.min(100, (budget.used / budget.cap) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {runningCount > 0 && <AgentMetric label="Running" value={runningCount} />}
          {waitingCount > 0 && <AgentMetric label="Waiting" value={waitingCount} />}
          {completedCount > 0 && <AgentMetric label="Done" value={completedCount} />}
          {fanoutLabel && <AgentMetric label="Fan-out" value={fanoutLabel} />}
        </div>
      )}
      {agents.length === 0 ? (
        status?.idleWaiting ? (
          <div className="text-xs text-fg-muted">
            waiting / {status.idleWaitingPendingCount ?? 0} pending
          </div>
        ) : fanoutLabel ? (
          <div className="text-xs text-fg-muted">{fanoutLabel}</div>
        ) : status?.budgetApprovalRequired ? (
          <div className="text-xs text-warn">budget approval needed</div>
        ) : (
          <div className="text-xs text-fg-muted">No delegated agents yet.</div>
        )
      ) : (
        <AgentInlineList agents={agents} />
      )}
    </Section>
  );
}

// ---- Changes section锛坓it porcelain 鏂囦欢鍒楄〃锛?----

function AgentMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}): JSX.Element {
  return (
    <span className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-secondary">
      <span className="text-fg-faint">{label}</span>{' '}
      <span className="font-mono text-fg-primary">{value}</span>
    </span>
  );
}

function AgentInlineList({
  agents,
}: {
  readonly agents: readonly AgentStatusViewModel[];
}): JSX.Element {
  return (
    <ul className="space-y-1.5">
      {agents.slice(0, 4).map((agent) => (
        <AgentStatusCard key={agent.id} agent={agent} compact />
      ))}
    </ul>
  );
}

function AgentStatusCard({
  agent,
  compact = false,
}: {
  readonly agent: AgentStatusViewModel;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <li
      className={`rounded-lg border px-2 py-1.5 ${agentCardClass(agent.state)}`}
      data-testid="task-dock-agent-card"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${agentDotClass(agent.state)}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-fg-primary" title={agent.title}>
              {agent.title}
            </span>
            <span className="flex-shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
              {agentStateLabel(agent.state)}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] text-fg-muted">
            {agent.role && <span>{agent.role}</span>}
            {agent.responsibility && <span className="truncate">/ {agent.responsibility}</span>}
          </div>
          {agent.latest && (
            <div
              className={`mt-1 text-[12px] leading-4 text-fg-secondary ${
                compact ? 'line-clamp-2' : ''
              }`}
              title={agent.latest}
            >
              {agent.latest}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-fg-faint">
            {agent.evidenceCount !== undefined && <span>{agent.evidenceCount} notes</span>}
            {agent.traceCount !== undefined && <span>{agent.traceCount} trace events</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

function agentCardClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'border-run/40 bg-run/10';
    case 'waiting':
      return 'border-warn/40 bg-warn/10';
    case 'completed':
      return 'border-ok/35 bg-ok/10';
    case 'error':
      return 'border-danger/40 bg-danger/10';
    case 'idle':
      return 'border-border-default bg-surface-2';
  }
}

function agentDotClass(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'bg-run animate-pulse';
    case 'waiting':
      return 'bg-warn';
    case 'completed':
      return 'bg-ok';
    case 'error':
      return 'bg-danger';
    case 'idle':
      return 'bg-fg-faint';
  }
}

function agentStateLabel(state: AgentStatusViewModel['state']): string {
  switch (state) {
    case 'active':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'completed':
      return 'Done';
    case 'error':
      return 'Issue';
    case 'idle':
      return 'Idle';
  }
}

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

function ChangesSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element | null {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  // 鐩戝惉 write/edit/bash tool_result 鈫?debounce 瑙﹀彂 refetch锛堟部鐢?StashNotice 鍚屾閫昏緫锛?
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
  // #11 fix: 涔嬪墠鏄?boolean guard鈥斺€旈」鐩?A 鐨勮姹傝繕娌″洖鏉ユ椂锛屽垏鍒伴」鐩?B 瑙﹀彂鐨勬柊璇锋眰浼氳杩欎釜
  // guard 鐩存帴鍚炴帀锛堜笉鏄?杩囨湡鍚庝涪寮?锛屾槸"鏍规湰娌″彂鍑哄幓"锛夛紝Changes 灏变竴鐩村仠鍦ㄦ棫蹇収锛岀洿鍒颁笅涓€娆?
  // tool_result/focus/30s 鍏滃簳杞鎵嶅彲鑳借ˉ鏁戙€傛敼鎴愯褰?褰撳墠鍦ㄩ鐨勭洰鏍?projectPath"鈥斺€斿悓涓€涓?
  // path 鎵嶅幓閲嶈烦杩囷紝鎹簡鏂伴」鐩€昏兘鍙戝嚭璇锋眰銆?
  const inFlightPathRef = useRef<string | null>(null);

  // F054: 鏀瑰姩閲忓ぇ鏃舵寜鐩綍鏍戞姌鍙犮€俢ollapsed = 宸叉姌鍙犵洰褰曠殑 path 闆嗗悎锛堥粯璁ゅ叏灞曞紑锛夈€?
  // 璺?refetch 鎸佷箙锛坘eyed by dir path锛夛紝30s 鍒锋柊涓嶄細閲嶇疆鐢ㄦ埛鐨勬姌鍙犳€併€?
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleDir = useCallback((dirPath: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);
  const pickFile = useCallback((filePath: string): void => {
    useAppStore.getState().setLastDiffPath(filePath);
    requestShellPopout('diff');
  }, []);
  const tree = useMemo(() => buildChangeTree(snapshot?.files ?? []), [snapshot?.files]);

  const fetchChanges = useCallback((path: string): void => {
    if (!window.kodaxSpace) return;
    if (inFlightPathRef.current === path) return;
    inFlightPathRef.current = path;
    void window.kodaxSpace
      .invoke('project.gitChanges', { projectRoot: path })
      .then((r) => {
        if (!r.ok) return;
        // 鐢ㄦ埛鍒囪蛋鏃朵涪寮?
        if (useAppStore.getState().currentProjectPath !== path) return;
        setSnapshot({
          isGitRepo: r.data.isGitRepo,
          branch: r.data.branch,
          files: [...r.data.files],
          truncated: r.data.truncated,
        });
      })
      .finally(() => {
        if (inFlightPathRef.current === path) inFlightPathRef.current = null;
      });
  }, []);

  useEffect(() => {
    // #11 fix: 椤圭洰鍒囨崲鏃跺厛鍚屾娓呯┖蹇収鈥斺€旈伩鍏嶅湪鏂拌姹傚洖鏉ヤ箣鍓嶏紝鍙充晶鏍忕煭鏆傦紙鍦ㄦ棫 boolean
    // guard 鍦烘櫙涓嬬敋鑷冲彲鑳介暱鏈燂級鏄剧ず涓婁竴涓」鐩殑鏀瑰姩鏂囦欢鍒楄〃銆?
    setSnapshot(null);
    if (!currentProjectPath) {
      return;
    }
    fetchChanges(currentProjectPath);
  }, [currentProjectPath, fetchChanges]);

  // tool_result debounced 閲嶈 + window focus + 30s 鍏滃簳锛堟部鐢?StashNotice 鍚屾瑙﹀彂鍣級
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

  if (!currentProjectPath) {
    return (
      <Section
        title={t('right.changes')}
        sectionId="changes"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="text-xs text-fg-muted">Open a project to review workspace changes.</div>
      </Section>
    );
  }

  if (!snapshot) {
    return (
      <Section title={t('right.changes')} sectionId="changes" focusRequest={focusRequest}>
        <div className="text-xs text-fg-muted">Loading workspace changes...</div>
      </Section>
    );
  }

  if (!snapshot.isGitRepo) {
    return (
      <Section
        title={t('right.changes')}
        sectionId="changes"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="text-xs text-fg-muted">This project is not a git repository.</div>
      </Section>
    );
  }

  return (
    <Section
      title={`${t('right.changes')} (${snapshot.files.length}${snapshot.truncated ? '+' : ''})`}
      sectionId="changes"
      focusRequest={focusRequest}
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

// ---- Changes 鐩綍鏍戯紙F054锛氭敼鍔ㄩ噺澶ф椂鎸夌洰褰曟姌鍙狅紝鍚崟閾剧洰褰曞帇缂╋級----

interface ChangeTreeNode {
  /** 鏄剧ず鐢ㄦ鍚嶏紙鍘嬬缉鍚庡彲鑳芥槸 "a/b/c"锛夈€俽oot 涓虹┖涓层€?*/
  name: string;
  /** 鐩綍鍏ㄨ矾寰勶紙鎶樺彔鐘舵€佺殑 key锛夈€?*/
  path: string;
  dirs: ChangeTreeNode[];
  files: GitChange[];
  /** 璇ュ瓙鏍戜笅鍙樺姩鏂囦欢鎬绘暟銆?*/
  count: number;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * 鎶婃墎骞虫枃浠跺垪琛ㄥ缓鎴愮洰褰曟爲銆備袱姝ワ細
 *   1) 鎸?'/' 鍒嗘寤哄祵濂楃洰褰?+ 鎶婃枃浠舵寕鍒版墍鍦ㄧ洰褰?
 *   2) finalize锛氱畻 count銆佹帓搴忋€佸帇缂╁崟閾剧洰褰曪紙鏃犳枃浠朵笖浠?1 瀛愮洰褰?鈫?骞舵垚 "a/b/c"锛孷S Code 鍚屾锛?
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
    // 鍘嬬缉鍗曢摼锛氭棤鐩村睘鏂囦欢涓斾粎 1 瀛愮洰褰曠殑鑺傜偣涓庡瓙鍚堝苟
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

/** 閫掑綊娓叉煋鐩綍鏍戯細鐩綍琛屽彲鎶樺彔锛坈hevron + folder + count锛夛紝鏂囦欢琛?鈫?鐐瑰紑 diff銆?*/
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
            data-testid="task-dock-change-file"
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
  // 棰滆壊锛歴taged 缁?/ worktree-only 鐞ョ弨 / untracked 鐏帮紱瀛楁瘝 = 鐘舵€侀瀛?
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

function ArtifactsSummarySection({
  focusRequest,
  artifactCount,
  hasArtifactSurface,
  artifactError,
  onOpenArtifact,
}: {
  readonly focusRequest: TaskDockFocusState;
  readonly artifactCount: number;
  readonly hasArtifactSurface: boolean;
  readonly artifactError: unknown;
  readonly onOpenArtifact: () => void;
}): JSX.Element {
  return (
    <Section
      title="Artifacts"
      sectionId="artifacts"
      focusRequest={focusRequest}
      defaultOpen={false}
    >
      {hasArtifactSurface ? (
        <div className="space-y-2 text-xs text-fg-secondary">
          <div>
            {artifactError
              ? 'Artifact loading needs attention.'
              : `${artifactCount} artifact${artifactCount === 1 ? '' : 's'} available.`}
          </div>
          <button
            type="button"
            onClick={onOpenArtifact}
            className="rounded-md border border-border-default px-2 py-1 text-[12px] text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
          >
            Open Artifact workspace
          </button>
        </div>
      ) : (
        <div className="text-xs text-fg-muted">Generated artifacts will appear here.</div>
      )}
    </Section>
  );
}

// ---- Working folder锛堥檷绾у埌搴曢儴锛?----

function SourcesSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element {
  const { t } = useI18n();
  const projectPath = useAppStore((s) => s.currentProjectPath);
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section title="Sources" sectionId="sources" focusRequest={focusRequest} defaultOpen={false}>
      {projectPath ? (
        <div className="text-xs text-fg-secondary space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">
            {t('right.workingFolder')}
          </div>
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
          {/* 2026-06-18: 宸ヤ綔鐩綍璺緞鍙偣鍑?鈫?鍦ㄦ枃浠剁鐞嗗櫒涓畾浣嶏紙鍚?璺緞涓嶅啀鏄鏂囨湰"涓绘棬锛夈€?*/}
          <button
            type="button"
            onClick={() => void revealPath(projectPath)}
            title="Reveal in file manager"
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

// ---- Context锛堥檷绾у埌搴曢儴锛?----

function ContextSection({
  focusRequest,
}: {
  readonly focusRequest: TaskDockFocusState;
}): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? (s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS) : EMPTY_EVENTS,
  );

  const refs = useMemo(() => collectContextRefs(events), [events]);

  if (refs.tools.length === 0 && refs.files.length === 0) {
    return (
      <Section
        title={t('right.context')}
        sectionId="context"
        focusRequest={focusRequest}
        defaultOpen={false}
      >
        <div className="text-xs text-fg-muted leading-relaxed">
          Track tools and referenced files used in this task.
        </div>
      </Section>
    );
  }

  return (
    <Section
      title={t('right.context')}
      sectionId="context"
      focusRequest={focusRequest}
      defaultOpen={false}
    >
      {refs.tools.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1">Tools used</div>
          <div className="flex flex-wrap gap-1">
            {refs.tools.map((t) => (
              <span
                key={t.name}
                className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-fg-secondary"
                title={`${t.count}x ${t.name}`}
              >
                {t.name}
                {t.count > 1 && <span className="text-fg-muted ml-0.5">x{t.count}</span>}
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
                    title={previewable ? `Preview ${f}` : `Reveal ${f}`}
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

// ---- 鍦嗙偣 svg-free 瀹炵幇 ----

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

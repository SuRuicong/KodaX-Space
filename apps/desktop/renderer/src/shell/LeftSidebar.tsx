// LeftSidebar — F011-revised + FEATURE_033 tree view
//
// Claude Desktop 风左侧侧栏：
//   ┌─────────────┐
//   │ [Coder][Partner]  ← surface tab (F045: Partner 可点，SurfaceTabs 组件)
//   │
//   │ + New session
//   │ ⏰ Scheduled  (灰，v0.1.x)
//   │ 💼 Customize  (灰，v0.1.x)
//   │ ▾ More
//   │
//   │ Recents ────────────────
//   │   · 项目分析
//   │     ⑂ 项目分析 (fork)         ← FEATURE_033 fork child 缩进显示
//   │   · 修个 bug
//   └─────────────┘
//
// ADR-004 v2 决策：常驻 Coder/Partner tab。F045 起 Partner 可点（抽到 SurfaceTabs 组件，
// 接 surface store）；LeftSidebar 是两 surface 共用的全局导航（项目 / session / surface tab）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Clock, Briefcase, ChevronDown, Settings, type LucideIcon } from 'lucide-react';
import { SurfaceTabs } from './SurfaceTabs.js';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { Caret } from '../components/Caret.js';
import {
  canonProjectRoot,
  type SessionMeta,
  type RunningSessionInfoT,
} from '@kodax-space/space-ipc-schema';
import { SessionContextMenu } from './SessionContextMenu.js';
import { ProjectContextMenu } from './ProjectContextMenu.js';
import { ProjectSessionPicker } from './ProjectSessionPicker.js';
import { RecentsFilterMenu } from './RecentsFilterMenu.js';
import { SettingsModal } from '../features/settings/SettingsModal.js';
import { WorkflowNavPanel } from '../features/workflow/WorkflowNavPanel.js';
import { useSessionStatusMap, type SessionStatus } from '../features/session/useSessionStatus.js';
import { pushToast } from '../store/toastStore.js';
import type { Project } from '@kodax-space/space-ipc-schema';
import { useI18n } from '../i18n/I18nProvider.js';

// Hover-prefetch: 用户鼠标悬停在 Recents 项上时,后台触发 session.history IPC
// 让 main 端 5-LRU cache (session-store.ts) 提前 warm 起来。等用户真正点击时,handler 命中
// cache → 几乎瞬时返回。模块级 Set 避免对同一 session 重复 prefetch。
// 只对 msgCount > 0 的 persisted session 做 (新空 session 没历史可拉)。
const prefetchedSessionIds = new Set<string>();
function prefetchSessionHistory(sessionId: string, msgCount: number | undefined): void {
  if (!msgCount || msgCount === 0) return; // 没历史不浪费 IPC
  if (prefetchedSessionIds.has(sessionId)) return;
  if (!window.kodaxSpace) return;
  prefetchedSessionIds.add(sessionId);
  // 失败也不打扰用户,只是失去 prefetch 优势 (用户真正点击时还有第二次机会)
  void window.kodaxSpace.invoke('session.history', { sessionId }).catch(() => {
    // 取消标记,让真正 click 还能再试
    prefetchedSessionIds.delete(sessionId);
  });
}

interface LeftSidebarProps {
  /** 2026-06: 动态宽度（px）。Shell 拖 ResizeHandle 实时改这个值。 */
  width?: number;
}

export function LeftSidebar({ width }: LeftSidebarProps): JSX.Element {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  // F045: 当前工作面（Coder / Partner）。session 列表按 surface 分面——切 surface 重新拉。
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const visibleSessions = useMemo(
    () => sessions.filter((s) => (s.surface ?? 'code') === currentSurface),
    [sessions, currentSurface],
  );

  // F040: 不再按 currentProjectPath 过滤拉 session —— 多项目 sidebar 需要全量。
  // 启动期拉一次；切项目 / 增删 session 触发的"补拉"未来要走显式 refresh 路径。
  // refetch 触发器：currentProjectPath 变化（开新项目可能带新 session）+ mount。
  // F045: 加 currentSurface —— Coder / Partner 会话列表彼此独立，切面时按新 surface 重拉。
  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;
    void bridge.invoke('session.list', { surface: currentSurface }).then((r) => {
      if (r.ok)
        useAppStore
          .getState()
          .replaceSessionsForScope(r.data.sessions, { surface: currentSurface });
    });
  }, [currentProjectPath, currentSurface]);

  /**
   * + New session：统一首页与新建。不再急建空 session（那会跳进零消息空白对话页，
   * 还往 RECENTS 塞一条 Untitled 空壳）；改为回到"无 session"落地态 —— WelcomeDashboard
   * + composer。真正的 session 由 BottomBar.ensureSession 在首次发送时懒建，用同一个
   * resolveSessionCreateInputs（pending → Space default → KodaX default）解析 provider/mode，
   * 所以 provider / 模式选择一点不丢（见 createSession.ts 头注释：两处调用已统一到该 helper）。
   */
  function handleNewSession(): void {
    setCurrentSession(null);
  }

  // OC-29: 底栏 ⚙ 打开 unified SettingsModal (默认 Preferences tab)
  const [settingsOpen, setSettingsOpen] = useState(false);

  // open/setOpen 由 Shell 顶层 breadcrumb 行的 SidebarToggleButton 直接管理；
  // open=false 时 Shell 不会渲染本组件（不再保留竖条占位 — 避免无信息密度的 dead zone）

  return (
    <aside
      data-testid="left-sidebar"
      style={width !== undefined ? { width: `${width}px` } : undefined}
      className="glass lift ix-zone flex flex-col border border-border-default rounded-xl overflow-hidden bg-surface flex-shrink-0 text-[13px]"
    >
      {/* Surface tab — F045: [Coder][Partner] 切换（Partner 自本版起可点） */}
      <SurfaceTabs />

      {/* New session + menus */}
      <div className="p-2 space-y-1">
        <button
          type="button"
          onClick={handleNewSession}
          disabled={!currentProjectPath}
          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-hover-bg text-fg-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={!currentProjectPath ? t('sidebar.openFolderFirst') : t('sidebar.newSession')}
        >
          <Plus className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
          {t('sidebar.newSession')}
        </button>
        <WorkflowNavPanel />
        <DisabledMenuItem Icon={Clock} label={t('sidebar.scheduled')} hint="v0.1.x" />
        <DisabledMenuItem Icon={Briefcase} label={t('sidebar.customize')} hint="v0.1.x" />
        <DisabledMenuItem Icon={ChevronDown} label={t('sidebar.more')} hint="" />
      </div>

      {/* F017 Running peers — 其他 KodaX 进程（CLI / 别的 Space 窗口）当前活动的 session。
          peers.length === 0 时整段隐藏不占空间。 */}
      <RunningPeersPanel />

      {/* Recents 标题 + 过滤按钮 (对齐 Claude Desktop 截图 3 的 ⚙) */}
      <RecentsHeader />

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {visibleSessions.length === 0 && (
          <div className="text-xs text-fg-muted px-2 py-3">
            {currentProjectPath ? t('sidebar.noSessionsYet') : t('sidebar.openFolderToStart')}
          </div>
        )}
        {/* F040: 多项目可折叠树。currentProjectPath 默认展开 + 高亮；
            其它项目折叠。状态点驱动来自 useSessionStatusMap。 */}
        <ProjectTree
          sessions={visibleSessions}
          currentSessionId={currentSessionId}
          onSelect={setCurrentSession}
        />
      </div>

      {/* Bottom: app label + settings entry */}
      <div className="border-t border-border-default px-3 py-2 text-[11px] text-fg-muted flex items-center justify-between gap-2 flex-shrink-0">
        <span className="min-w-0 truncate">KodaX Space</span>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="ix-pop inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-fg-secondary hover:bg-hover-bg hover:text-fg-primary"
          aria-label={t('common.settings')}
          title={t('common.settings')}
        >
          <Settings className="w-4 h-4" strokeWidth={1.75} aria-hidden />
          <span>{t('common.settings')}</span>
        </button>
      </div>
      {settingsOpen && (
        <SettingsModal initialTab="preferences" onClose={() => setSettingsOpen(false)} />
      )}
    </aside>
  );
}

/**
 * F040: 多项目可折叠树外层。
 *
 * 顶层 = 已打开过的所有项目（store.projects），按 lastUsedAt 倒序。当前项目默认展开
 * 且高亮；其它项目折叠态。展开状态持久化到 localStorage（store.expandedProjects）。
 *
 * 每项目内复用 SessionTree（传 projectRootOverride 强制按本项目 path 过滤，不受
 * recentsFilter.projectScope 影响）。状态点：useSessionStatusMap 一次拍全部 session
 * 状态，按需传给每个 SessionTree。
 *
 * 折叠项目节点显示运行数计数（🟢N），让用户一眼看到哪个项目里有 agent 在跑。
 *
 * 边界：
 *   - store.projects 为空 → 不渲染（fallback 到上方"Open a folder"提示）
 *   - 某项目在 store.projects 但没 sessions → 仍渲染节点但展开后空（提示用户）
 *   - 某 session 的 projectRoot 不在 store.projects → 漏出来不渲染（orphan）；
 *     这不应发生（projectStore 用 SDK listSessions 来源 + project.recent.add），
 *     如果真发生说明 SDK 给了脏数据，安全做法是隐藏不暴露
 */
function ProjectTree({
  sessions,
  currentSessionId,
  onSelect,
}: {
  readonly sessions: readonly SessionMeta[];
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  const projects = useAppStore((s) => s.projects);
  const setProjects = useAppStore((s) => s.setProjects);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const expandedProjects = useAppStore((s) => s.expandedProjects);
  const toggleProjectExpanded = useAppStore((s) => s.toggleProjectExpanded);
  // v0.1.9 Step 7 — 拖排顺序 + archived 折叠状态 (持久化)
  const projectOrder = useAppStore((s) => s.projectOrder);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const archivedExpanded = useAppStore((s) => s.archivedProjectsExpanded);
  const setArchivedExpanded = useAppStore((s) => s.setArchivedProjectsExpanded);

  // F043: 项目级 contextmenu 状态 + inline rename
  const [projCtxMenu, setProjCtxMenu] = useState<{ project: Project; x: number; y: number } | null>(
    null,
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // v0.1.9 Step 7 — DnD: 拖动中的 source canon path (UI 高亮 + drop 时算位置)
  const [dragSrcCanon, setDragSrcCanon] = useState<string | null>(null);
  const [dragOverCanon, setDragOverCanon] = useState<string | null>(null);
  // v0.1.9: "+N more sessions" picker overlay — 哪个项目正在浏览全量
  const [pickerProject, setPickerProject] = useState<Project | null>(null);

  // refresh local projects from main after IPC mutation
  const refreshProjects = useCallback(async (): Promise<void> => {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.list', undefined);
    if (r.ok) {
      setProjects(r.data.projects);
    } else {
      // MED-4 fix：原静默 drop → sidebar 跟 main 端不一致；surface error 让用户重试
      pushToast(t('sidebar.refreshFailed'), 'error');
    }
  }, [setProjects, t]);

  // 全 session id 列表 → 一次拿状态 map（reducer 内部按 id 切片，比每个 SessionRow 单独 hook 省 N 次 store subscribe）
  const allSessionIds = useMemo(() => sessions.map((s) => s.sessionId), [sessions]);
  const statusMap = useSessionStatusMap(allSessionIds);

  // 项目排序优先级:
  //   1. v0.1.9 Step 7: 用户拖排过 (projectOrder 非空) → 按 projectOrder 排,新项目追加到尾
  //   2. 旧默认: lastUsedAt 倒序 + currentProject 排首 (用户没拖过时保留原体验)
  // F043: archived 项目从主列表剔出,单独"Archived (N)"分组展示。
  const ordered = useMemo(() => {
    const curCanon = currentProjectPath ? canonProjectRootBrowser(currentProjectPath) : null;
    const active = projects.filter((p) => p.archived !== true);

    if (projectOrder.length > 0) {
      // 用户已拖排过: 按 projectOrder 索引排,不在里面的追加(按 lastUsedAt 内部排)。
      // review MEDIUM-1: 即便拖过,**当前打开的项目**仍然 pin 到最顶 — 用户切到老项目时
      // 视觉焦点不应跳到中段。这跟 Codex/IDE workspace switch 体感一致。
      const orderIdx = new Map<string, number>();
      projectOrder.forEach((p, i) => orderIdx.set(p, i));
      const sorted = [...active].sort((a, b) => {
        const aIdx = orderIdx.get(canonProjectRootBrowser(a.path)) ?? Infinity;
        const bIdx = orderIdx.get(canonProjectRootBrowser(b.path)) ?? Infinity;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return b.lastUsedAt - a.lastUsedAt;
      });
      if (!curCanon) return sorted;
      const curIdx = sorted.findIndex((p) => canonProjectRootBrowser(p.path) === curCanon);
      if (curIdx <= 0) return sorted;
      const current = sorted[curIdx]!;
      return [current, ...sorted.slice(0, curIdx), ...sorted.slice(curIdx + 1)];
    }

    const sorted = [...active].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    if (!curCanon) return sorted;
    const curIdx = sorted.findIndex((p) => canonProjectRootBrowser(p.path) === curCanon);
    if (curIdx <= 0) return sorted;
    const current = sorted[curIdx]!;
    return [current, ...sorted.slice(0, curIdx), ...sorted.slice(curIdx + 1)];
  }, [projects, projectOrder, currentProjectPath]);

  const archived = useMemo(
    () => projects.filter((p) => p.archived === true).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    [projects],
  );

  // 按 projectRoot 把 sessions 分组（用 canonProjectRoot 比较，避免 windows 大小写 / trailing
  // slash / 分隔符差异）。reviewer MED-2: 用不可变 spread 而非 push 原地改，遵循项目 immutability 规则。
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, readonly SessionMeta[]>();
    for (const s of sessions) {
      const k = canonProjectRootBrowser(s.projectRoot);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [sessions]);

  // statusFor 闭包：从 statusMap 取，O(1)。给每个 SessionTree 共享同一个 closure。
  // reviewer MED-1: useCallback 让 reference 稳定跟 statusMap 走，避免 statusMap 没变时
  // 每次 ProjectTree 渲染都新建函数让下游 SessionTree 误重渲染。
  const statusFor = useCallback(
    (sid: string): SessionStatus => statusMap[sid] ?? 'idle',
    [statusMap],
  );

  // F043 review HIGH-1 修：blur=cancel, Enter=commit。原 onBlur 也调 submit 会让
  // Enter → setRenamingPath(null) → input unmount → blur 触发第二次 submit，并发两条 IPC。
  // 现在 onBlur 直接 setRenamingPath(null) 不动 IPC；只有 Enter 走 commit。
  const onRenameCommit = useCallback(
    async (proj: Project, newName: string): Promise<void> => {
      setRenamingPath(null);
      const trimmed = newName.trim();
      if (trimmed.length === 0 || trimmed === proj.name) return; // no-op / unchanged
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('project.recent.rename', {
        path: proj.path,
        name: trimmed,
      });
      if (!r.ok || !r.data.renamed) {
        pushToast(t('sidebar.renameFailed'), 'error');
        return;
      }
      await refreshProjects();
    },
    [refreshProjects, t],
  );

  // ⚠️ 早 return 必须放在所有 hooks 之后 —— 否则首次启动 (projects 空) 提前 return 会跳过
  //    下面的 onRenameCommit useCallback，项目注入后又执行，hooks 顺序不一致 → React #310 → 白屏。
  //    这是个反复踩过的坑：新增 hook 一律加在这行之前。
  if (ordered.length === 0 && archived.length === 0) return null;

  const renderProject = (proj: Project, treatAsCurrent: boolean): JSX.Element => {
    const projCanon = canonProjectRootBrowser(proj.path);
    const defaultExpanded = treatAsCurrent;
    const explicit = proj.path in expandedProjects ? expandedProjects[proj.path] : undefined;
    const isExpanded = explicit !== undefined ? explicit : defaultExpanded;
    const projSessions = sessionsByProject.get(projCanon) ?? [];
    const runningCount = projSessions.reduce(
      (acc, s) => (statusMap[s.sessionId] === 'running' ? acc + 1 : acc),
      0,
    );
    const isRenaming = renamingPath === proj.path;

    // v0.1.9 Step 7 — DnD: 项目 row 整行 draggable。archived 项目不参与排序(语义上"已归档"
    // 用户的 mental model 跟主列表不同),只对 active list 启用。
    // review HIGH-3: 上下文菜单开着时禁拖 — 用户右键打开菜单后随手 mousedown 可能误触
    // dragstart,造成菜单 + drag 状态打架。
    const isArchivedRow = proj.archived === true;
    const isCtxMenuOnRow = projCtxMenu?.project.path === proj.path;
    const isDragSource = dragSrcCanon === projCanon;
    const isDragOverTarget = dragOverCanon === projCanon && dragSrcCanon !== null && !isDragSource;
    return (
      <div key={proj.path} className={`mb-1 ${isDragSource ? 'opacity-40' : ''}`}>
        <div
          draggable={!isArchivedRow && !isRenaming && !isCtxMenuOnRow}
          onDragStart={(e) => {
            if (isArchivedRow) return;
            setDragSrcCanon(projCanon);
            e.dataTransfer.effectAllowed = 'move';
            // 必须 setData 才能在 Firefox / 某些 Linux 上触发 drag (Chrome 不严要求,但写上更稳)
            try {
              e.dataTransfer.setData('text/plain', proj.path);
            } catch {
              /* fail silently */
            }
          }}
          onDragEnd={() => {
            setDragSrcCanon(null);
            setDragOverCanon(null);
          }}
          onDragOver={(e) => {
            if (isArchivedRow || dragSrcCanon === null || dragSrcCanon === projCanon) return;
            e.preventDefault(); // 允许 drop
            e.dataTransfer.dropEffect = 'move';
            if (dragOverCanon !== projCanon) setDragOverCanon(projCanon);
          }}
          onDragLeave={(e) => {
            // review HIGH-1: onDragLeave 也会在 cursor 移入 row 内子元素时触发(button / span 等),
            // 直接清 dragOverCanon 会让 outline 在 row 内闪烁。只有 cursor 真的离开整个 row
            // (relatedTarget 不在 row DOM 之内) 时才清。
            if (dragOverCanon !== projCanon) return;
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as HTMLElement).contains(related)) return;
            setDragOverCanon(null);
          }}
          onDrop={(e) => {
            if (isArchivedRow) return;
            e.preventDefault();
            const src = dragSrcCanon;
            setDragSrcCanon(null);
            setDragOverCanon(null);
            if (!src || src === projCanon) return;
            reorderProjects(src, projCanon);
          }}
          className={`group/projectrow w-full text-xs px-2 py-1 rounded flex items-center gap-1.5 ${
            treatAsCurrent
              ? 'text-fg-primary font-semibold'
              : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
          } ${isDragOverTarget ? 'outline outline-1 outline-info/60' : ''}`}
          onContextMenu={(e) => {
            e.preventDefault();
            setProjCtxMenu({ project: proj, x: e.clientX, y: e.clientY });
          }}
          title={proj.path}
        >
          <button
            type="button"
            onClick={() => toggleProjectExpanded(proj.path, defaultExpanded)}
            className="text-fg-muted flex-shrink-0"
            aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
          >
            <Caret open={isExpanded} />
          </button>
          {isRenaming ? (
            <input
              type="text"
              defaultValue={proj.name}
              autoFocus
              maxLength={256}
              className="flex-1 bg-surface-2 border border-border-strong rounded px-1 py-0.5 text-xs text-fg-primary outline-none focus:border-border-strong"
              onBlur={() => setRenamingPath(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onRenameCommit(proj, e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenamingPath(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              onClick={() => toggleProjectExpanded(proj.path, defaultExpanded)}
              className="flex-1 text-left truncate"
            >
              {proj.name}
            </button>
          )}
          {runningCount > 0 && !isRenaming && (
            <span
              className="text-ok text-[11px] flex-shrink-0 font-mono"
              aria-label={`${runningCount} running`}
              title={`${runningCount} session${runningCount === 1 ? '' : 's'} running`}
            >
              ●{runningCount}
            </span>
          )}
          {/* v0.1.9: hover-only inline buttons — new session + contextmenu (codex 对齐) */}
          {!isRenaming && (
            <span className="flex items-center gap-0.5 opacity-0 group-hover/projectrow:opacity-100 transition-opacity flex-shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // 切到此项目 + 清 current session → BottomBar.ensureSession 在首发时
                  // 懒建一个新 session（跟顶部"+ New session"按钮同一路径）
                  const st = useAppStore.getState();
                  st.setCurrentProject(proj.path);
                  st.setCurrentSession(null);
                }}
                className="text-fg-muted hover:text-fg-primary px-1 leading-none"
                aria-label={`${t('sidebar.newSessionInProject')}: ${proj.name}`}
                title={t('sidebar.newSessionInProject')}
              >
                ＋
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setProjCtxMenu({ project: proj, x: rect.right, y: rect.bottom });
                }}
                className="text-fg-muted hover:text-fg-primary px-1 leading-none"
                aria-label={`${proj.name} actions`}
                title={t('sidebar.moreActions')}
              >
                ⋯
              </button>
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="ml-1">
            {projSessions.length === 0 ? (
              <div className="text-[11px] text-fg-muted italic px-3 py-1">
                {t('sidebar.noProjectSessions')}
              </div>
            ) : (
              <SessionTree
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSelect={onSelect}
                projectRootOverride={proj.path}
                statusFor={statusFor}
                maxVisible={SESSIONS_PER_PROJECT_VISIBLE}
                onShowMore={() => setPickerProject(proj)}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    // review HIGH-2: 包一个 wrapper 让 onDragLeave / onDragEnd 兜底 — 用户拖出 sidebar
    // 整个 area 后 (浏览器有时不会发 row 的 onDragLeave),outline 不会被永久 stuck。
    <div
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        // related 不在 wrapper 内 = 拖出本 list
        if (related && (e.currentTarget as HTMLElement).contains(related)) return;
        if (dragOverCanon !== null) setDragOverCanon(null);
      }}
      onDragEnd={() => {
        // 浏览器有时只在 source 上发 onDragEnd,有时在 document 上 — wrapper 多挂一道,
        // 兜底清掉拖动状态。
        if (dragSrcCanon !== null) setDragSrcCanon(null);
        if (dragOverCanon !== null) setDragOverCanon(null);
      }}
    >
      {ordered.map((proj) => {
        const projCanon = canonProjectRootBrowser(proj.path);
        const isCurrent = currentProjectPath
          ? projCanon === canonProjectRootBrowser(currentProjectPath)
          : false;
        return renderProject(proj, isCurrent);
      })}

      {archived.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border-default/40">
          <button
            type="button"
            onClick={() => setArchivedExpanded(!archivedExpanded)}
            className="w-full text-left text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary px-2 py-1 flex items-center gap-1.5"
            aria-expanded={archivedExpanded}
          >
            <Caret open={archivedExpanded} />
            {t('sidebar.archived')} ({archived.length})
          </button>
          {archivedExpanded && (
            <div className="opacity-60">{archived.map((proj) => renderProject(proj, false))}</div>
          )}
        </div>
      )}

      {projCtxMenu && (
        <ProjectContextMenu
          project={projCtxMenu.project}
          x={projCtxMenu.x}
          y={projCtxMenu.y}
          onClose={() => setProjCtxMenu(null)}
          onStartRename={() => {
            setRenamingPath(projCtxMenu.project.path);
            setProjCtxMenu(null);
          }}
          onProjectsChanged={refreshProjects}
        />
      )}

      {pickerProject && (
        <ProjectSessionPicker
          projectName={pickerProject.name}
          // 把本项目所有 session 按 lastActivityAt desc 排好传进去
          sessions={(sessionsByProject.get(canonProjectRootBrowser(pickerProject.path)) ?? [])
            .slice()
            .sort((a, b) => b.lastActivityAt - a.lastActivityAt)}
          currentSessionId={currentSessionId}
          onSelect={(sid) => {
            useAppStore.getState().setCurrentProject(pickerProject.path);
            onSelect(sid);
          }}
          onClose={() => setPickerProject(null)}
        />
      )}
    </div>
  );
}

/**
 * FEATURE_033: 按 parentSessionId 把 sessions 排成 root → children 树。
 * 渲染顺序：每个 root 紧跟其 descendants（DFS pre-order）；fork child 缩进 + 用 ⑂ 图标。
 *
 * 边界处理：
 *   - parent 已被 delete 了 → orphan：当 root 渲染（仍能选中、不丢）
 *   - cycle 防御：DFS 走过的 id 不再重复进入
 */
interface SessionTreeProps {
  readonly sessions: readonly SessionMeta[];
  readonly currentSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
  /** F040: 多项目模式时由 ProjectTree 传该项目路径，覆盖 filter.projectScope 行为，
   *  让每个 SessionTree 严格只渲染自己项目的 session。缺省走原来的 projectScope filter。 */
  readonly projectRootOverride?: string;
  /** F040: 每行末尾的状态点。idle 不渲染（避免噪音）；缺省整个 sidebar 都不显示状态。 */
  readonly statusFor?: (sessionId: string) => SessionStatus;
  /** v0.1.9：默认显示上限。超过 cap 时下方渲染"+N more"按钮；undefined = 不 cap (legacy). */
  readonly maxVisible?: number;
  /** v0.1.9：点 "+N more" 按钮的回调，让 ProjectTree 唤出 ProjectSessionPicker overlay。 */
  readonly onShowMore?: () => void;
}

// v0.1.5: canonProjectRootBrowser 替换为 schema 包共享 util（F040/F041 review MED-3）。
// 旧实现跟 main 侧 normalize 算法略有差异 (Windows UNC / 多重分隔符) → 现在两边走同一函数。
const IS_WIN = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
function canonProjectRootBrowser(p: string): string {
  return canonProjectRoot(p, IS_WIN);
}

// v0.1.9：项目下默认显示 N 个最近 session；超过走 ProjectSessionPicker overlay。
// 实测 KodaX 项目 200+ sessions 全塞 sidebar 会把别的项目挤下面。8 个是 codex
// 同款上限；想看更多走"+ N more sessions" → 中央 picker 模糊搜 + 选。
const SESSIONS_PER_PROJECT_VISIBLE = 8;

function SessionTree({
  sessions,
  currentSessionId,
  onSelect,
  projectRootOverride,
  statusFor,
  maxVisible,
  onShowMore,
}: SessionTreeProps): JSX.Element {
  const sessionFlags = useAppStore((s) => s.sessionFlags);
  const filter = useAppStore((s) => s.recentsFilter);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);

  // 应用 filter：status / lastActivity / projectScope
  // F040：projectRootOverride 设了的话 projectScope filter 被替换为强等于该路径，
  //       让 ProjectTree 多项目模式下每个 SessionTree 严格只渲染自己项目的 session。
  const visible = useMemo(() => {
    const now = Date.now();
    const cutoff =
      filter.lastActivity === 'today'
        ? now - 24 * 3600 * 1000
        : filter.lastActivity === '7d'
          ? now - 7 * 24 * 3600 * 1000
          : filter.lastActivity === '30d'
            ? now - 30 * 24 * 3600 * 1000
            : 0;
    const overrideCanon = projectRootOverride ? canonProjectRootBrowser(projectRootOverride) : null;
    const curCanon = currentProjectPath ? canonProjectRootBrowser(currentProjectPath) : null;
    return sessions.filter((s) => {
      const f = sessionFlags[s.sessionId];
      if (filter.status === 'active' && f?.archived) return false;
      if (filter.status === 'archived' && !f?.archived) return false;
      if (overrideCanon !== null) {
        if (canonProjectRootBrowser(s.projectRoot) !== overrideCanon) return false;
      } else if (filter.projectScope === 'current' && curCanon) {
        if (canonProjectRootBrowser(s.projectRoot) !== curCanon) return false;
      }
      if (cutoff > 0 && s.lastActivityAt < cutoff) return false;
      return true;
    });
  }, [sessions, sessionFlags, filter, currentProjectPath, projectRootOverride]);

  // 排序：pinned 顶部 + sortBy 选项决定二级排序
  const rendered = useMemo(() => {
    const tree = buildSessionTreeOrder(visible, (id) => Boolean(sessionFlags[id]?.pinned));
    if (filter.sortBy === 'recency') return tree;
    // 对 flat tree 二次排序（树形结构下 alphabetical/created 仅排 root；children 保 DFS 序）
    return tree.slice().sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (filter.sortBy === 'alphabetical') {
        return (a.session.title ?? '').localeCompare(b.session.title ?? '');
      }
      // created
      return b.session.createdAt - a.session.createdAt;
    });
  }, [visible, sessionFlags, filter.sortBy]);
  // 右键菜单状态：哪个 session + 屏幕坐标
  const [ctxMenu, setCtxMenu] = useState<{ session: SessionMeta; x: number; y: number } | null>(
    null,
  );
  // 内联 rename：哪个 session 正在编辑（点 Rename / 双击触发）
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);

  // v0.1.9：cap visible 行数。规则：
  //  1. 没设 maxVisible → 全显（legacy）
  //  2. 设了 maxVisible → 取前 maxVisible 条；如果 currentSessionId 在 rendered 里但
  //     不在 maxVisible 前缀，**强制把 current 拼进 visible 头部**（用户至少能看到自己
  //     当前选中的那条，而不是因为它 lastActivity 不够新被吞掉）
  const cappedRendered = useMemo(() => {
    if (maxVisible === undefined || rendered.length <= maxVisible) return rendered;
    const head = rendered.slice(0, maxVisible);
    if (currentSessionId === null) return head;
    if (head.some((n) => n.session.sessionId === currentSessionId)) return head;
    const currentNode = rendered.find((n) => n.session.sessionId === currentSessionId);
    if (currentNode === undefined) return head;
    // current 不在前缀里 → 加进头部，再 cap 一次（多保留一条 visual signal）
    return [currentNode, ...head];
  }, [rendered, maxVisible, currentSessionId]);
  const overflowCount = maxVisible !== undefined ? rendered.length - cappedRendered.length : 0;

  return (
    <>
      {cappedRendered.map(({ session, depth }) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          depth={depth}
          isSelected={session.sessionId === currentSessionId}
          flags={sessionFlags[session.sessionId]}
          isRenaming={renamingSessionId === session.sessionId}
          status={statusFor?.(session.sessionId)}
          onSelect={onSelect}
          onContextMenu={(x, y) => setCtxMenu({ session, x, y })}
          onStartRename={() => setRenamingSessionId(session.sessionId)}
          onCancelRename={() => setRenamingSessionId(null)}
        />
      ))}
      {overflowCount > 0 && onShowMore !== undefined && (
        <button
          type="button"
          onClick={onShowMore}
          className="w-full text-left text-xs text-fg-muted hover:text-fg-primary px-3 py-1 flex items-center gap-1.5"
          aria-label={`Browse all ${rendered.length} sessions in this project`}
        >
          <span
            className="w-3 flex items-center justify-center flex-shrink-0 text-base leading-none text-fg-muted"
            aria-hidden
          >
            +
          </span>
          <span className="italic">
            {overflowCount} more session{overflowCount === 1 ? '' : 's'}…
          </span>
        </button>
      )}
      {ctxMenu && (
        <SessionContextMenu
          session={ctxMenu.session}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onStartRename={() => {
            setRenamingSessionId(ctxMenu.session.sessionId);
            setCtxMenu(null);
          }}
        />
      )}
    </>
  );
}

interface SessionTreeNode {
  readonly session: SessionMeta;
  readonly depth: number;
}

/** DFS pre-order，root 按 (pinned 优先) → lastActivityAt 倒序；children 同样倒序。 */
export function buildSessionTreeOrder(
  sessions: readonly SessionMeta[],
  isPinned: (sessionId: string) => boolean = () => false,
): readonly SessionTreeNode[] {
  const byId = new Map<string, SessionMeta>(sessions.map((s) => [s.sessionId, s]));
  const childrenByParent = new Map<string, SessionMeta[]>();
  const roots: SessionMeta[] = [];
  for (const s of sessions) {
    if (s.parentSessionId !== undefined && byId.has(s.parentSessionId)) {
      const bucket = childrenByParent.get(s.parentSessionId) ?? [];
      bucket.push(s);
      childrenByParent.set(s.parentSessionId, bucket);
    } else {
      roots.push(s);
    }
  }
  // pinned 在前，其后按 lastActivityAt 倒序
  const orderFn = (a: SessionMeta, b: SessionMeta): number => {
    const pa = isPinned(a.sessionId) ? 1 : 0;
    const pb = isPinned(b.sessionId) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.lastActivityAt - a.lastActivityAt;
  };
  roots.sort(orderFn);
  for (const list of childrenByParent.values()) list.sort(orderFn);

  const out: SessionTreeNode[] = [];
  const visited = new Set<string>();
  function walk(s: SessionMeta, depth: number): void {
    if (visited.has(s.sessionId)) return; // cycle guard
    visited.add(s.sessionId);
    out.push({ session: s, depth });
    const kids = childrenByParent.get(s.sessionId) ?? [];
    for (const c of kids) walk(c, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return out;
}

/**
 * SessionRow 行首标识。之前用文字 `·`（fork 用 `⑂`），渲染只有 ~3px 且基线偏移、很难看清
 * （用户反馈太小，2026-06-08）。改成实心圆点（fork 仍用放大的 `⑂` 字形），尺寸放大到 7px。
 */
function SessionBullet({ isFork }: { isFork: boolean }): JSX.Element {
  if (isFork) {
    return (
      <span
        className="text-fg-muted text-[13px] leading-none w-3 text-center flex-shrink-0"
        aria-hidden
      >
        ⑂
      </span>
    );
  }
  return (
    <span className="w-3 flex items-center justify-center flex-shrink-0" aria-hidden>
      <span className="w-[7px] h-[7px] rounded-full bg-fg-muted" />
    </span>
  );
}

function SessionRow({
  session,
  depth,
  isSelected,
  flags,
  isRenaming,
  status,
  onSelect,
  onContextMenu,
  onStartRename,
  onCancelRename,
}: {
  session: SessionMeta;
  depth: number;
  isSelected: boolean;
  flags: { pinned?: boolean; archived?: boolean; unread?: boolean } | undefined;
  isRenaming: boolean;
  /** F040: per-session 状态点。'idle' 不渲染。 */
  status?: SessionStatus;
  onSelect: (id: string) => void;
  onContextMenu: (x: number, y: number) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
}): JSX.Element {
  const upsertSession = useAppStore((s) => s.upsertSession);
  const indent = Math.min(depth, 4); // 不无限缩进；4 层就够
  const isFork = depth > 0 || session.parentSessionId !== undefined;
  const padLeft = `${0.5 + indent * 0.8}rem`;

  async function commitRename(value: string): Promise<void> {
    const trimmed = value.trim().slice(0, 256);
    onCancelRename();
    if (trimmed === '' || trimmed === (session.title ?? '')) return;
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('session.setTitle', {
      sessionId: session.sessionId,
      title: trimmed,
    });
    if (r.ok) upsertSession({ ...session, title: trimmed });
  }

  if (isRenaming) {
    return (
      <div
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface-3 text-fg-primary`}
        style={{ paddingLeft: padLeft }}
      >
        <SessionBullet isFork={isFork} />
        <RenameInput
          initial={session.title ?? ''}
          onCommit={(v) => void commitRename(v)}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(session.sessionId)}
      onMouseEnter={() => prefetchSessionHistory(session.sessionId, session.msgCount)}
      onDoubleClick={onStartRename}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className={`w-full text-left text-xs px-2 py-1 rounded truncate flex items-center gap-1 ${
        isSelected
          ? 'bg-surface-3 text-fg-primary'
          : 'text-fg-secondary hover:bg-hover-bg hover:text-fg-primary'
      }`}
      style={{ paddingLeft: padLeft }}
      title={`${session.title ?? session.sessionId} (double-click to rename)`}
    >
      <SessionBullet isFork={isFork} />
      {flags?.pinned && (
        <span className="text-warn text-[11px]" aria-hidden title="Pinned">
          📌
        </span>
      )}
      <span className="truncate flex-1">{session.title ?? 'Untitled session'}</span>
      {flags?.unread && (
        <span className="text-ok text-[11px]" aria-hidden title="Unread">
          ●
        </span>
      )}
      {/* F040 状态点：idle 不渲染（最常态、避免视觉噪音）。awaiting/error/running 都用单色圆点。 */}
      {status && status !== 'idle' && (
        <span
          className={`text-[11px] flex-shrink-0 ${
            status === 'awaiting'
              ? 'text-warn'
              : status === 'error'
                ? 'text-danger'
                : 'text-ok' /* running */
          }`}
          aria-hidden
          title={
            status === 'awaiting'
              ? 'Awaiting confirmation'
              : status === 'error'
                ? 'Errored'
                : 'Running'
          }
        >
          ●
        </span>
      )}
    </button>
  );
}

/** Inline rename input — Enter 提交、Esc / blur 取消（避免静默改名误操作） */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <input
      type="text"
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
      onFocus={(e) => e.currentTarget.select()}
      className="flex-1 bg-transparent text-fg-primary text-xs outline-none border-b border-border-strong focus:border-warn px-0.5 -mx-0.5"
      placeholder="Session title"
      maxLength={256}
      aria-label="Rename session"
    />
  );
}

// F017 Running peers panel — 列其他 KodaX 进程当前活动的 session。
//   - 数据源：SDK listRunningSessions() 通过 session.listRunning IPC
//   - 轮询：10s 一次（cheap — 走 instance-state 文件读，不开 socket）
//   - 点击有 sessionId 的 peer → setCurrentSession (Space tryResume 会从 disk 读 jsonl)
//     注：CLI 还在跑时 Space 接管会和 CLI 双写 jsonl；KodaX storage 有 serializedWrite
//     队列防腐败，但内容会乱序。v1 当"只读 / passive resume"语义；显式 takeover SDK 没出
//   - peers 为空时 panel 不渲染（不占侧栏空间）
function RunningPeersPanel(): JSX.Element | null {
  const [peers, setPeers] = useState<readonly RunningSessionInfoT[]>(EMPTY_PEERS);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      if (!window.kodaxSpace) return;
      const r = await window.kodaxSpace.invoke('session.listRunning', undefined);
      if (cancelled) return;
      if (r.ok) setPeers(r.data.peers);
    }
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    // window focus 也触发一次刷新——切回 Space 立刻看到新 peer 状态
    function onFocus(): void {
      void refresh();
    }
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (peers.length === 0) return null;

  return (
    <div className="border-b border-border-default px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-1 px-1 flex items-center gap-1.5">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ok" />
        <span>Running · {peers.length}</span>
      </div>
      {peers.map((p) => {
        const cwdName = (p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.cwd).slice(0, 32);
        const ageSec = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000));
        const ageLabel =
          ageSec < 60
            ? `${ageSec}s`
            : ageSec < 3600
              ? `${Math.floor(ageSec / 60)}m`
              : `${Math.floor(ageSec / 3600)}h`;
        const isClickable = p.sessionId !== undefined && p.sessionId !== currentSessionId;
        return (
          <button
            key={`${p.pid}-${p.sessionId ?? 'bootstrapping'}`}
            type="button"
            onClick={() => p.sessionId && setCurrentSession(p.sessionId)}
            disabled={!isClickable}
            className={[
              'w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1.5',
              isClickable
                ? 'hover:bg-hover-bg text-fg-secondary cursor-pointer'
                : 'text-fg-muted cursor-default',
            ].join(' ')}
            title={
              p.sessionId
                ? `pid ${p.pid} · session ${p.sessionId}\ncwd: ${p.cwd}\nclick to open (read-only resume while peer is alive)`
                : `pid ${p.pid} · session bootstrapping\ncwd: ${p.cwd}`
            }
          >
            <span aria-hidden className="text-fg-faint font-mono flex-shrink-0">
              ⚙
            </span>
            <span className="truncate flex-1">{cwdName}</span>
            <span className="text-[9px] text-fg-muted font-mono flex-shrink-0">{ageLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

const EMPTY_PEERS: readonly RunningSessionInfoT[] = [];

function RecentsHeader(): JSX.Element {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const filter = useAppStore((s) => s.recentsFilter);
  // 显示当前过滤 summary，给用户暗示"我现在看的是哪部分"
  const summary =
    filter.status !== 'active' ||
    filter.lastActivity !== 'all' ||
    filter.sortBy !== 'recency' ||
    filter.groupBy !== 'none'
      ? `${filter.status === 'active' ? '' : filter.status + ' · '}${filter.sortBy}`
      : null;
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-fg-muted flex justify-between items-center flex-shrink-0 relative">
      {/* F043 v0.1.9: 改为"Projects" — 实际形态就是项目折叠树，原 Recents 概念被
          ProjectTree 取代；点 ⇅ 仍调过滤菜单（session 级 active/archived/sort 等）。 */}
      <span>{t('sidebar.projects')}</span>
      <div className="flex items-center gap-2">
        {summary && <span className="normal-case text-fg-muted text-[9px]">{summary}</span>}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="text-fg-muted hover:text-fg-primary normal-case"
          aria-label="Filter projects / sessions"
          title="Filter, group, sort"
        >
          ⇅
        </button>
      </div>
      <RecentsFilterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorEl={buttonRef.current}
      />
    </div>
  );
}

function DisabledMenuItem({
  Icon,
  label,
  hint,
}: {
  Icon: LucideIcon;
  label: string;
  hint: string;
}): JSX.Element {
  return (
    <div
      className="w-full text-xs px-2 py-1.5 rounded text-fg-muted cursor-not-allowed flex items-center gap-2"
      title={hint ? `${label} — ${hint}` : label}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
      {hint && <span className="ml-auto text-[9px] text-fg-muted">{hint}</span>}
    </div>
  );
}

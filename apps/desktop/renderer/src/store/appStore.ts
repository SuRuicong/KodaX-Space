// Zustand 全局 store — F005 起。
//
// 设计：
//   - 三块状态：projects（recent list）/ sessions（当前项目下）/ events（按 sessionId 路由）
//   - actions 只做"应用 main 端响应"，**不**直接修改持久数据；persistence 在 main 侧
//   - 事件路由：renderer 全局订阅 `session.event` 一次，按 payload.sessionId 进
//     `eventsBySession.get(sessionId)`；切换 currentSession 不重订阅，只切视图
//
// 不放进 store 的：
//   - 临时表单状态（promptDraft 等）—— 留在组件 local state
//   - 异步进行中标志（busy）—— 同上

import { create } from 'zustand';
import type {
  Project,
  ProviderInfo,
  SessionMeta,
  SessionEvent,
  PermissionRequestPayload,
  AskUserRequestPayload,
  KodaxUserDefaults,
} from '@kodax-space/space-ipc-schema';

/**
 * Recents 列表过滤 / 分组 / 排序 状态 — 对齐 Claude Desktop 截图 3。
 * alpha.1 阶段全部存 renderer 本地（不持久化重启清空）；后续需要的话再持久化到 main。
 */
export interface RecentsFilter {
  status: 'active' | 'archived' | 'all';
  /** 'current' 只显示 currentProjectPath 的；'all' 跨项目（v0.1.x main 端要按 project 拆开发） */
  projectScope: 'current' | 'all';
  lastActivity: 'today' | '7d' | '30d' | 'all';
  groupBy: 'none' | 'project' | 'status';
  sortBy: 'recency' | 'alphabetical' | 'created';
}

const DEFAULT_RECENTS_FILTER: RecentsFilter = {
  status: 'active',
  projectScope: 'current',
  lastActivity: 'all',
  groupBy: 'none',
  sortBy: 'recency',
};

/**
 * 用户在 renderer 端发出的 prompt 记录。
 * Main 端不会把用户 prompt 通过 push channel 回放——它是 invoke 的入参，单向。
 * Renderer 自己保留一份，与 session.event push 流共同构成完整对话。
 */
export interface UserMessage {
  /** 唯一 id：sessionId + 单调 counter 拼接，保 React key 稳定。*/
  readonly id: string;
  readonly content: string;
  readonly sentAt: number;
}

interface AppState {
  // ----- 数据 -----
  projects: readonly Project[];
  currentProjectPath: string | null;
  sessions: readonly SessionMeta[];
  currentSessionId: string | null;
  /** 每个 sessionId 一桶事件；append-only。Map 用 plain object 避免 zustand referential 问题。*/
  eventsBySession: Readonly<Record<string, readonly SessionEvent[]>>;
  /** 每个 sessionId 一桶用户消息（renderer 本地跟踪）。*/
  userMessagesBySession: Readonly<Record<string, readonly UserMessage[]>>;
  /**
   * 待用户决策的 permission 请求队列（FIFO）。
   * 一次只显示一个弹窗——多 session 并发时按到达顺序处理，已决策的弹下一个。
   * 不按 sessionId 桶分——弹窗永远是 modal 全屏，按全局队列处理更简单也防止用户同时
   * 看到多个弹窗时手抖点错。
   */
  permissionQueue: readonly PermissionRequestPayload[];

  /**
   * FEATURE_032: 待用户决策的 askUser 请求队列。与 permissionQueue 并行——前者是
   * "tool 调用 gate"，后者是 "agent / guardrail 主动问问题"，UI 不同 modal、不互相阻塞。
   */
  askUserQueue: readonly AskUserRequestPayload[];

  /** Provider catalog（built-in + custom）+ configured 状态。FEATURE_004。*/
  providers: readonly ProviderInfo[];
  defaultProviderId: string | null;
  /**
   * v0.1.6 cleanup：~/.kodax/config.json 的默认值（main 启动期一次性拉过来）。
   * Space defaultProviderId === null 时这里 fallback；用户改 Space 设置 / 切 picker 后用 Space 值。
   * null = 还没拉到或 SDK loadConfig 失败；undefined 字段 = config 没设那项。
   */
  kodaxDefaults: KodaxUserDefaults | null;
  /**
   * Keychain backend 状态。'memory' 表示 key 仅在本进程内有效；
   * UI 应显著告警，否则用户以为配了 key 但重启就丢（review M1-sec）。
   */
  keychainBackend: 'keychain' | 'memory' | 'unknown';

  /**
   * F008: 每个 session 的当前 Work 预算（used / cap）。
   * 由 session-event 'work_budget' 增量更新，覆盖最新值（main 端是权威源）。
   * alpha.1：也从 managed_task_status.globalWorkBudget/budgetUsage 派生。
   */
  workBudgetBySession: Readonly<Record<string, { used: number; cap: number } | undefined>>;
  /** F008: 每个 session 的当前 harness profile（H0/H1/H2）+ round。
   *  alpha.1：也从 managed_task_status.harnessProfile/currentRound 派生（profile 名映射）。
   */
  harnessProfileBySession: Readonly<
    Record<
      string,
      | { profile: 'H0_DIRECT' | 'H1_EXECUTE_EVAL' | 'H2_PLAN_EXECUTE_EVAL'; round?: number }
      | undefined
    >
  >;
  /**
   * alpha.1: Scout-seeded todo list per session.
   * 由 session-event 'todo_update' 全量替换最新列表。空列表也是有效状态（表示 todo cleared）。
   */
  todoListBySession: Readonly<
    Record<
      string,
      | ReadonlyArray<{
          id: string;
          content: string;
          status: 'pending' | 'in_progress' | 'completed';
          activeForm?: string;
        }>
      | undefined
    >
  >;
  /**
   * alpha.1: KodaX managed task / subagent 最新状态。
   * 由 session-event 'managed_task_status' 全量替换最新值（main 端在每次 status 变化时推一次）。
   * 字段对照 KodaXManagedTaskStatusEvent — agentMode / harnessProfile / activeWorker / budget /
   * idleWaiting / childFanoutCount / events[] 等。
   */
  managedTaskStatusBySession: Readonly<
    Record<
      string,
      | Extract<SessionEvent, { kind: 'managed_task_status' }>['status']
      | undefined
    >
  >;
  /**
   * 当前无 session 时由 ModelEffortSelector 写入的"下一次新 session 用这些"。
   * 用户点 picker 选 glm/zai-glm-coding/effort 等 → 存这里 → 下次 BottomBar 自动建 session
   * 或 LeftSidebar 显式 + New session 时优先用这俩值。
   * null/undefined 表示"沿用 Space defaultProviderId / kodaxDefaults"。
   */
  pendingProviderId: string | null;
  pendingReasoningMode: SessionMeta['reasoningMode'] | null;
  pendingPermissionMode: SessionMeta['permissionMode'] | null;
  /**
   * Session UX flags — alpha.1 阶段不持久化（重启清空）。
   *   - pinned：sidebar Recents 顶部置顶
   *   - archived：sidebar 默认隐藏（用 sort/filter 弹窗 → Archived 才显示）
   *   - unread：sidebar 标题旁加 ● 圆点（用户标记，非自动）
   * v0.1.x SDK 出持久化字段后迁移到 SessionMeta。
   */
  sessionFlags: Readonly<Record<string, { pinned?: boolean; archived?: boolean; unread?: boolean } | undefined>>;
  /** UI 主题。dark = 当前默认；light = zinc-100 系；'system' = 跟 OS prefers-color-scheme。
   *  持久化到 localStorage 让重启后保持。*/
  theme: 'dark' | 'light' | 'system';
  /** Recents 列表过滤+分组+排序选项 — alpha.1 不持久化。*/
  recentsFilter: RecentsFilter;
  /**
   * Transcript view — Claude Desktop 截图 7 同款。
   *   - normal: 默认 (assistant 消息 + tool calls)
   *   - thinking: 展开 thinking_chunk blocks
   *   - verbose: 显示所有事件 (含 system_notice / iteration_*）
   *   - summary: 每 turn 折叠成单行 (高密度浏览)
   * fontSize: 'sm' | 'base' | 'lg' — 对应 Aa Aa Aa 三档
   */
  transcriptView: 'normal' | 'thinking' | 'verbose' | 'summary';
  transcriptFontSize: 'sm' | 'base' | 'lg';
  /**
   * F009: 最后一次被 tool_call (write/edit) 触及的相对路径——FilePanel 监听这个值切到 diff 视图。
   * 用 "可读完一次就置 null" 的单值 + clearLastDiffPath 模式，避免 useEffect 反复触发。
   */
  lastDiffPath: string | null;
  /**
   * F009 内部：tool_start 的 path 暂存，等 tool_result 落地时取出 → 写 lastDiffPath。
   * Renderer 永不直接读这个字段；不导出 selector。
   */
  pendingToolPaths: Readonly<Record<string, string>>;

  // ----- actions -----
  setProjects(projects: readonly Project[]): void;
  setCurrentProject(path: string | null): void;
  setSessions(sessions: readonly SessionMeta[]): void;
  setCurrentSession(sessionId: string | null): void;
  appendEvent(event: SessionEvent): void;
  appendUserMessage(sessionId: string, content: string): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(sessionId: string): void;
  enqueuePermission(req: PermissionRequestPayload): void;
  /** 用户决策完 / main 端 cancel 推过来 / session 删除 — 都从队列里挪走。*/
  dequeuePermission(reqId: string): void;
  /** FEATURE_032: askUser 队列管理 (与 permissionQueue 同模式)。*/
  enqueueAskUser(req: AskUserRequestPayload): void;
  dequeueAskUser(reqId: string): void;
  setProviders(
    providers: readonly ProviderInfo[],
    defaultProviderId: string | null,
    keychainBackend: 'keychain' | 'memory' | 'unknown',
  ): void;
  /** v0.1.6 cleanup: 启动期 main 推 kodax.getDefaults 结果进来。 */
  setKodaxDefaults(defaults: KodaxUserDefaults): void;
  /** 用户在无 session 时点 picker → 暂存到 pending；下次 session.create 优先用。*/
  setPendingProviderId(id: string | null): void;
  setPendingReasoningMode(mode: SessionMeta['reasoningMode'] | null): void;
  setPendingPermissionMode(mode: SessionMeta['permissionMode'] | null): void;
  /** Session UX flags — 局部状态 (alpha.1 不持久化)。toggle 形 + 合并形 set 函数。*/
  toggleSessionFlag(sessionId: string, flag: 'pinned' | 'archived' | 'unread'): void;
  setRecentsFilter(filter: RecentsFilter): void;
  setTheme(theme: 'dark' | 'light' | 'system'): void;
  setTranscriptView(v: AppState['transcriptView']): void;
  setTranscriptFontSize(s: AppState['transcriptFontSize']): void;
  /** 切项目时清空当前 session 选择和事件 buffer（事件留主进程的；renderer 只清缓存）。*/
  resetSessionView(): void;
  /** FEATURE_031: /clear 命令清空指定 session 的事件 / 用户消息 buffer (session 本体保留)。*/
  resetSessionMessages(sessionId: string): void;
  /**
   * FEATURE_033 fork：把 source 的 user messages [0..forkPointTurnIdx] + 全部对应 events
   * 复制到 newSessionId 的 buffer。main 端已经把新 session 加进 list (caller responsible
   * for upsertSession with new meta)；本 action 只负责 buffer 复制。
   */
  forkSessionBuffers(srcSessionId: string, newSessionId: string, forkPointTurnIdx: number): void;
  /**
   * FEATURE_033 rewind：截断 sessionId 的 buffer 到 rewindPastTurnIdx (含)。
   *   - userMessagesBySession 保留 [0..idx] 共 idx+1 条
   *   - eventsBySession 保留 [0..events-before-(idx+1)-th-user-message]
   * 越界 idx 静默 no-op（main 端不持有 events 不会报 invalid_index，校验放这层）。
   */
  rewindSessionBuffers(sessionId: string, rewindPastTurnIdx: number): void;
  /** F009: FilePanel 读完 lastDiffPath 后清掉，避免反复 jump。*/
  clearLastDiffPath(): void;
}

// 单调 counter 用于生成 stable id——sessionId 内多条 user message 顺序唯一。
let userMessageCounter = 0;

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  currentProjectPath: null,
  sessions: [],
  currentSessionId: null,
  eventsBySession: {},
  userMessagesBySession: {},
  permissionQueue: [],
  askUserQueue: [],
  providers: [],
  defaultProviderId: null,
  keychainBackend: 'unknown',
  kodaxDefaults: null,
  workBudgetBySession: {},
  harnessProfileBySession: {},
  todoListBySession: {},
  managedTaskStatusBySession: {},
  lastDiffPath: null,
  pendingToolPaths: {},
  pendingProviderId: null,
  pendingReasoningMode: null,
  pendingPermissionMode: null,
  sessionFlags: {},
  recentsFilter: DEFAULT_RECENTS_FILTER,
  theme: (typeof window !== 'undefined' && (localStorage.getItem('kodax-space.theme') as 'dark' | 'light' | 'system' | null)) || 'dark',
  transcriptView: 'normal',
  transcriptFontSize: 'base',

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (path) => set({ currentProjectPath: path }),
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  appendUserMessage: (sessionId, content) =>
    set((state) => {
      if (!state.sessions.some((s) => s.sessionId === sessionId)) return state;
      const bucket = state.userMessagesBySession[sessionId] ?? [];
      const id = `u_${sessionId}_${++userMessageCounter}`;
      const msg: UserMessage = { id, content, sentAt: Date.now() };
      return {
        userMessagesBySession: {
          ...state.userMessagesBySession,
          [sessionId]: [...bucket, msg],
        },
      };
    }),

  appendEvent: (event) =>
    set((state) => {
      // 切项目 / 删除 session 后，旧 session 的迟到事件仍会通过同一 push channel 到达。
      // 如果 renderer 没有这条 session 的记录就 drop——否则会累积无人引用的 bucket。
      // main 端事件是权威；renderer 只缓存自己 UI 里能见到的部分。
      if (!state.sessions.some((s) => s.sessionId === event.sessionId)) return state;
      const bucket = state.eventsBySession[event.sessionId] ?? [];
      const next: Partial<AppState> = {
        eventsBySession: {
          ...state.eventsBySession,
          [event.sessionId]: [...bucket, event],
        },
      };
      // F008: 同步抽取 work_budget / harness_profile 到 derived maps
      // —— 视图不必每次 scan 整条 bucket
      if (event.kind === 'work_budget') {
        next.workBudgetBySession = {
          ...state.workBudgetBySession,
          [event.sessionId]: { used: event.used, cap: event.cap },
        };
      } else if (event.kind === 'harness_profile') {
        next.harnessProfileBySession = {
          ...state.harnessProfileBySession,
          [event.sessionId]: { profile: event.profile, round: event.round },
        };
      } else if (event.kind === 'todo_update') {
        // alpha.1: 全量替换；空列表表示 cleared
        next.todoListBySession = {
          ...state.todoListBySession,
          [event.sessionId]: event.items,
        };
      } else if (event.kind === 'managed_task_status') {
        // alpha.1: 直接覆盖最新值。同时派生 legacy work_budget / harness_profile
        // 以便老 TasksPanel/Tabs 仍能渲染。
        next.managedTaskStatusBySession = {
          ...state.managedTaskStatusBySession,
          [event.sessionId]: event.status,
        };
        const ws = event.status;
        if (ws.budgetUsage !== undefined && ws.globalWorkBudget !== undefined) {
          next.workBudgetBySession = {
            ...state.workBudgetBySession,
            [event.sessionId]: { used: ws.budgetUsage, cap: ws.globalWorkBudget },
          };
        }
        // KodaX harnessProfile 是字符串（KodaXHarnessProfile）；老 enum 限 H0/H1/H2。
        // 已知映射：'H0_DIRECT' / 'H1_EXECUTE_EVAL' / 'H2_PLAN_EXECUTE_EVAL' 字面量直接通过；
        // 其他 KodaX 自定义 profile 留 undefined（保留旧值，避免抖动）。
        const profile = ws.harnessProfile;
        if (
          profile === 'H0_DIRECT' ||
          profile === 'H1_EXECUTE_EVAL' ||
          profile === 'H2_PLAN_EXECUTE_EVAL'
        ) {
          next.harnessProfileBySession = {
            ...state.harnessProfileBySession,
            [event.sessionId]: { profile, round: ws.currentRound },
          };
        }
      } else if (event.kind === 'auto_engine_change') {
        // FEATURE_029: auto-mode engine 切换（user manual / denial threshold / circuit breaker）。
        // 更新 session.autoModeEngine 让 ModeSelector 立即反映；本地 store 不持久化，
        // 重启后 main 端 list 重新拉权威值。
        next.sessions = state.sessions.map((s) =>
          s.sessionId === event.sessionId ? { ...s, autoModeEngine: event.engine } : s,
        );
      } else if (event.kind === 'tool_start') {
        // F009：记 toolId → path 暂存；等 tool_result 来配对决定要不要 jump 到 diff
        // input.path 由 mock-session / real adapter 在 tool_start 时附上
        if (
          (event.toolName === 'write' || event.toolName === 'edit') &&
          event.input &&
          typeof event.input.path === 'string'
        ) {
          next.pendingToolPaths = {
            ...state.pendingToolPaths,
            [event.toolId]: event.input.path,
          };
        }
      } else if (event.kind === 'tool_result') {
        // F009：write/edit 完成 + tool_start 暂存了 path → 触发 FilePanel 跳 diff
        const pendingPath = state.pendingToolPaths[event.toolId];
        if (pendingPath && (event.toolName === 'write' || event.toolName === 'edit')) {
          next.lastDiffPath = pendingPath;
          // 同时清掉 pending（防止内存累积）
          const { [event.toolId]: _drop, ...restPending } = state.pendingToolPaths;
          next.pendingToolPaths = restPending;
        }
      }
      return next;
    }),

  upsertSession: (meta) =>
    set((state) => {
      const existingIdx = state.sessions.findIndex((s) => s.sessionId === meta.sessionId);
      if (existingIdx < 0) {
        return { sessions: [meta, ...state.sessions] };
      }
      const next = state.sessions.slice();
      next[existingIdx] = meta;
      return { sessions: next };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      // 同时清掉对应事件 buffer 和 user message buffer——session 不在了，留着就是泄漏
      const { [sessionId]: _evt, ...restEvents } = state.eventsBySession;
      const { [sessionId]: _msg, ...restMsgs } = state.userMessagesBySession;
      const { [sessionId]: _bud, ...restBudgets } = state.workBudgetBySession;
      const { [sessionId]: _prof, ...restProfiles } = state.harnessProfileBySession;
      const { [sessionId]: _todo, ...restTodos } = state.todoListBySession;
      const { [sessionId]: _mts, ...restMts } = state.managedTaskStatusBySession;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: restEvents,
        userMessagesBySession: restMsgs,
        workBudgetBySession: restBudgets,
        harnessProfileBySession: restProfiles,
        todoListBySession: restTodos,
        managedTaskStatusBySession: restMts,
        permissionQueue: state.permissionQueue.filter((p) => p.sessionId !== sessionId),
        askUserQueue: state.askUserQueue.filter((p) => p.sessionId !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
        // F009: 删 session 不能让 pending tool path / lastDiffPath 留指着已删 session
        lastDiffPath:
          state.currentSessionId === sessionId ? null : state.lastDiffPath,
      };
    }),

  enqueuePermission: (req) =>
    set((state) => {
      // 防 main 端重发同 reqId（push 不应当重发，但兜底）
      if (state.permissionQueue.some((p) => p.reqId === req.reqId)) return state;
      return { permissionQueue: [...state.permissionQueue, req] };
    }),

  dequeuePermission: (reqId) =>
    set((state) => ({
      permissionQueue: state.permissionQueue.filter((p) => p.reqId !== reqId),
    })),

  enqueueAskUser: (req) =>
    set((state) => {
      if (state.askUserQueue.some((p) => p.reqId === req.reqId)) return state;
      return { askUserQueue: [...state.askUserQueue, req] };
    }),

  dequeueAskUser: (reqId) =>
    set((state) => ({
      askUserQueue: state.askUserQueue.filter((p) => p.reqId !== reqId),
    })),

  setProviders: (providers, defaultProviderId, keychainBackend) =>
    set({ providers, defaultProviderId, keychainBackend }),

  setKodaxDefaults: (defaults) => set({ kodaxDefaults: defaults }),

  setPendingProviderId: (id) => set({ pendingProviderId: id }),
  setPendingReasoningMode: (mode) => set({ pendingReasoningMode: mode }),
  setPendingPermissionMode: (mode) => set({ pendingPermissionMode: mode }),

  setRecentsFilter: (filter) => set({ recentsFilter: filter }),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('kodax-space.theme', theme); } catch { /* SSR / private mode */ }
    }
    set({ theme });
  },
  setTranscriptView: (v) => set({ transcriptView: v }),
  setTranscriptFontSize: (s) => set({ transcriptFontSize: s }),

  toggleSessionFlag: (sessionId, flag) =>
    set((state) => {
      const cur = state.sessionFlags[sessionId] ?? {};
      const next = { ...cur, [flag]: !cur[flag] };
      // 全 false 时彻底删 entry，防 sessionFlags 表无限增长 (旧 sessionId 残留)
      if (!next.pinned && !next.archived && !next.unread) {
        const { [sessionId]: _drop, ...rest } = state.sessionFlags;
        return { sessionFlags: rest };
      }
      return { sessionFlags: { ...state.sessionFlags, [sessionId]: next } };
    }),

  clearLastDiffPath: () => set({ lastDiffPath: null }),

  resetSessionView: () =>
    set({
      currentSessionId: null,
      eventsBySession: {},
      userMessagesBySession: {},
      permissionQueue: [],
      askUserQueue: [],
      workBudgetBySession: {},
      harnessProfileBySession: {},
      todoListBySession: {},
      managedTaskStatusBySession: {},
      sessions: [],
      lastDiffPath: null,
      pendingToolPaths: {},
    }),

  resetSessionMessages: (sessionId) =>
    set((state) => {
      // 同步剥掉本 session 在 pendingToolPaths 中暂存的 tool_id → path 记录
      // 否则 /clear 后若一个迟来的 tool_result 带相同 toolId，会触发 FilePanel
      // 跳到一个用户刚清掉的 diff（F031+F009 交互回归 — reviewer batch HIGH-1）。
      const events = state.eventsBySession[sessionId] ?? [];
      const toolIdsInThisSession = new Set<string>();
      for (const ev of events) {
        if (ev.kind === 'tool_start') toolIdsInThisSession.add(ev.toolId);
      }
      const nextPending: Record<string, string> = {};
      for (const [tid, path] of Object.entries(state.pendingToolPaths)) {
        if (!toolIdsInThisSession.has(tid)) nextPending[tid] = path;
      }
      return {
        eventsBySession: { ...state.eventsBySession, [sessionId]: [] },
        userMessagesBySession: { ...state.userMessagesBySession, [sessionId]: [] },
        pendingToolPaths: nextPending,
      };
    }),

  // FEATURE_033: fork = clone full buffer 到 newSessionId。
  // forkPointTurnIdx 当前仅作 metadata 记录（main 端已经写 session 上）；不在 renderer 层
  // 按 turn 切，因为 in-memory 阶段 UX 是 "在当前对话末尾分叉一条平行线"。
  // KodaX SDK 0.7.42 出 forkSession() 后 main 端会接磁盘，renderer 这层直接 setSessions 即可。
  //
  // **pendingToolPaths 不复制到 fork**（reviewer batch HIGH-2 的 follow-up）：
  // toolId 是 per-invocation UUID 全局唯一，永不复用——source 的 in-flight 工具 tool_result
  // 会路由回 source session（不是 fork），让 source 的 pending 自己清。fork 的"pending tool"
  // 概念只对 fork 自己产生的新 tool_start 才有意义。所以 fork 启动时 pendingToolPaths 自然为空。
  forkSessionBuffers: (srcSessionId, newSessionId, _forkPointTurnIdx) =>
    set((state) => {
      const srcEvents = state.eventsBySession[srcSessionId] ?? [];
      const srcMsgs = state.userMessagesBySession[srcSessionId] ?? [];
      // events 里的 sessionId 字段是 source 的——为新 session 重建 events 时需要改 sessionId，
      // 否则 ConversationStreamV2 按 sessionId 过滤会读不到。这里直接做映射。
      const remapped = srcEvents.map((e) => ({ ...e, sessionId: newSessionId } as SessionEvent));
      return {
        eventsBySession: { ...state.eventsBySession, [newSessionId]: remapped },
        userMessagesBySession: { ...state.userMessagesBySession, [newSessionId]: srcMsgs.slice() },
      };
    }),

  // FEATURE_033 rewind: 截断 userMessages 与 events buffer 到 rewindPastTurnIdx (含)。
  //   - userMessages 保留前 idx+1 条
  //   - events 按 session_complete / session_error 分 turn：保留前 idx+1 个 turn 的全部 events
  //   - idx >= 现有 turn 数 → silent no-op (renderer 校验，main 不持有 events)
  //
  // **同时清空 derived state maps**（reviewer F033 HIGH-1）：
  // todoList / workBudget / managedTaskStatus / harnessProfile 都是 per-session 派生状态，
  // 由 appendEvent 累积。rewind 跨过 turn 边界后，这些值不再对应剩余 events——若不重置会
  // 在 UI 上显示 stale 数据（如已被截掉那轮的 todo list、过高的 work budget 计数）。
  // 重置后用户继续 send 时自然由新 events 重新填充。
  rewindSessionBuffers: (sessionId, rewindPastTurnIdx) =>
    set((state) => {
      const msgs = state.userMessagesBySession[sessionId] ?? [];
      const events = state.eventsBySession[sessionId] ?? [];
      // idx 越界 → 啥都不做
      if (rewindPastTurnIdx < 0 || rewindPastTurnIdx >= msgs.length) return state;
      const newMsgs = msgs.slice(0, rewindPastTurnIdx + 1);
      // events 按 session_complete/session_error 分段，保留前 (rewindPastTurnIdx + 1) 段。
      //
      // 命名说明：`completedTurnsBefore` 表示"在当前位置之前已经完成的 turn 数"——
      // 第一次见到 session_complete 时为 0（处理 turn 0），第二次为 1（turn 1）...
      // 当 completedTurnsBefore === rewindPastTurnIdx 时即在处理目标 turn 末尾，
      // 切到 i+1 (含本条 session_complete) 即"保留 turns 0..idx 共 idx+1 个"。
      let completedTurnsBefore = 0;
      let sliceEnd = events.length; // 默认保留全部（last turn 还没 complete 时）
      for (let i = 0; i < events.length; i++) {
        const k = events[i].kind;
        if (k === 'session_complete' || k === 'session_error') {
          if (completedTurnsBefore === rewindPastTurnIdx) {
            sliceEnd = i + 1;
            break;
          }
          completedTurnsBefore++;
        }
      }
      // 同步清掉 derived state（不区分 turn 边界——简单一致，让 events 重新驱动）
      const { [sessionId]: _todo, ...restTodos } = state.todoListBySession;
      const { [sessionId]: _bud, ...restBudgets } = state.workBudgetBySession;
      const { [sessionId]: _mts, ...restMts } = state.managedTaskStatusBySession;
      const { [sessionId]: _prof, ...restProfiles } = state.harnessProfileBySession;
      return {
        userMessagesBySession: { ...state.userMessagesBySession, [sessionId]: newMsgs },
        eventsBySession: { ...state.eventsBySession, [sessionId]: events.slice(0, sliceEnd) },
        todoListBySession: restTodos,
        workBudgetBySession: restBudgets,
        managedTaskStatusBySession: restMts,
        harnessProfileBySession: restProfiles,
      };
    }),
}));

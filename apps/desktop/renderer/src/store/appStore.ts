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
} from '@kodax-space/space-ipc-schema';

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

  /** Provider catalog（built-in + custom）+ configured 状态。FEATURE_004。*/
  providers: readonly ProviderInfo[];
  defaultProviderId: string | null;
  /**
   * Keychain backend 状态。'memory' 表示 key 仅在本进程内有效；
   * UI 应显著告警，否则用户以为配了 key 但重启就丢（review M1-sec）。
   */
  keychainBackend: 'keychain' | 'memory' | 'unknown';

  /**
   * F008: 每个 session 的当前 Work 预算（used / cap）。
   * 由 session-event 'work_budget' 增量更新，覆盖最新值（main 端是权威源）。
   */
  workBudgetBySession: Readonly<Record<string, { used: number; cap: number } | undefined>>;
  /** F008: 每个 session 的当前 harness profile（H0/H1/H2）+ round。*/
  harnessProfileBySession: Readonly<
    Record<
      string,
      | { profile: 'H0_DIRECT' | 'H1_EXECUTE_EVAL' | 'H2_PLAN_EXECUTE_EVAL'; round?: number }
      | undefined
    >
  >;

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
  setProviders(
    providers: readonly ProviderInfo[],
    defaultProviderId: string | null,
    keychainBackend: 'keychain' | 'memory' | 'unknown',
  ): void;
  /** 切项目时清空当前 session 选择和事件 buffer（事件留主进程的；renderer 只清缓存）。*/
  resetSessionView(): void;
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
  providers: [],
  defaultProviderId: null,
  keychainBackend: 'unknown',
  workBudgetBySession: {},
  harnessProfileBySession: {},

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
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: restEvents,
        userMessagesBySession: restMsgs,
        workBudgetBySession: restBudgets,
        harnessProfileBySession: restProfiles,
        permissionQueue: state.permissionQueue.filter((p) => p.sessionId !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
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

  setProviders: (providers, defaultProviderId, keychainBackend) =>
    set({ providers, defaultProviderId, keychainBackend }),

  resetSessionView: () =>
    set({
      currentSessionId: null,
      eventsBySession: {},
      userMessagesBySession: {},
      permissionQueue: [],
      workBudgetBySession: {},
      harnessProfileBySession: {},
      sessions: [],
    }),
}));

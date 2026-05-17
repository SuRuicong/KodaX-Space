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
import type { Project, SessionMeta, SessionEvent } from '@kodax-space/space-ipc-schema';

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

  // ----- actions -----
  setProjects(projects: readonly Project[]): void;
  setCurrentProject(path: string | null): void;
  setSessions(sessions: readonly SessionMeta[]): void;
  setCurrentSession(sessionId: string | null): void;
  appendEvent(event: SessionEvent): void;
  appendUserMessage(sessionId: string, content: string): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(sessionId: string): void;
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
      return {
        eventsBySession: {
          ...state.eventsBySession,
          [event.sessionId]: [...bucket, event],
        },
      };
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
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: restEvents,
        userMessagesBySession: restMsgs,
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      };
    }),

  resetSessionView: () =>
    set({
      currentSessionId: null,
      eventsBySession: {},
      userMessagesBySession: {},
      sessions: [],
    }),
}));

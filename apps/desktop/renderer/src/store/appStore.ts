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

interface AppState {
  // ----- 数据 -----
  projects: readonly Project[];
  currentProjectPath: string | null;
  sessions: readonly SessionMeta[];
  currentSessionId: string | null;
  /** 每个 sessionId 一桶事件；append-only。Map 用 plain object 避免 zustand referential 问题。*/
  eventsBySession: Readonly<Record<string, readonly SessionEvent[]>>;

  // ----- actions -----
  setProjects(projects: readonly Project[]): void;
  setCurrentProject(path: string | null): void;
  setSessions(sessions: readonly SessionMeta[]): void;
  setCurrentSession(sessionId: string | null): void;
  appendEvent(event: SessionEvent): void;
  upsertSession(meta: SessionMeta): void;
  removeSession(sessionId: string): void;
  /** 切项目时清空当前 session 选择和事件 buffer（事件留主进程的；renderer 只清缓存）。*/
  resetSessionView(): void;
}

export const useAppStore = create<AppState>((set) => ({
  projects: [],
  currentProjectPath: null,
  sessions: [],
  currentSessionId: null,
  eventsBySession: {},

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (path) => set({ currentProjectPath: path }),
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

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
      // 同时清掉对应事件 buffer——session 不在了，留着事件就是泄漏
      const { [sessionId]: _, ...rest } = state.eventsBySession;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        eventsBySession: rest,
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      };
    }),

  resetSessionView: () =>
    set({
      currentSessionId: null,
      eventsBySession: {},
      sessions: [],
    }),
}));

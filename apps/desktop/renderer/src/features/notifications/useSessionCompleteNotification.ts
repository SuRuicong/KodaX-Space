// F020 + KX-I-07 — long-task completion native OS notification hook.
//
// 触发条件 (AND)：
//   1. session_complete / session_error event 到达
//   2. 距离用户发送 prompt 已经超过 LONG_TASK_THRESHOLD_MS (60s)
//   3. 窗口当前不在前台 (document.hidden 或 !document.hasFocus())
//
// 三者同时满足才发原生通知 —— 短任务不打扰、用户在看屏幕时不弹冗余、
// 失败 / 完成都通知（用户也想知道失败）。
//
// 触发后调 IPC notification.show；click 由 main 端 setRendererTarget 推
// 'notification.clicked' → 在 App.tsx 监听层接住做 setCurrentSession。

import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore.js';

const LONG_TASK_THRESHOLD_MS = 60_000;

interface PromptStartRecord {
  /** 该 session 最近一次"用户敲 Enter 时刻"。空时表示 in-flight tracking 未启动 */
  readonly startedAt: number;
}

/**
 * 监听全局 events stream + userMessages stream。
 *
 *   - user sends prompt → 记 startedAt
 *   - session_complete / session_error → 计算 elapsed；超 60s + 窗口非前台 → fire notification
 *
 * App.tsx 整个 lifecycle 挂载一次即可。
 */
export function useSessionCompleteNotification(): void {
  const eventsBySession = useAppStore((s) => s.eventsBySession);
  const userMessagesBySession = useAppStore((s) => s.userMessagesBySession);
  const sessions = useAppStore((s) => s.sessions);

  // 每个 session 的"最近 prompt 开始时刻"
  const startedAtRef = useRef<Map<string, PromptStartRecord>>(new Map());
  // 每个 session 已经通知过的最末事件 index —— 避免对历史回灌的 complete 事件重复通知
  const lastNotifiedEventIdxRef = useRef<Map<string, number>>(new Map());

  // 1) 跟踪 userMessages 末尾增量 → 更新 startedAt
  useEffect(() => {
    for (const [sid, msgs] of Object.entries(userMessagesBySession)) {
      const last = msgs[msgs.length - 1];
      if (!last) continue;
      const cur = startedAtRef.current.get(sid);
      // sentAt 是 UserMessage 自带；空时退到 Date.now()
      const startedAt = last.sentAt ?? Date.now();
      if (!cur || cur.startedAt !== startedAt) {
        startedAtRef.current.set(sid, { startedAt });
      }
    }
  }, [userMessagesBySession]);

  // 2) 监听 events 末尾 → 发现 session_complete / session_error 时计算。
  //
  // v0.1.10 bug fix: 用户打开已有 session 时不停弹 "Session done · 46h 6m" 通知。
  // 根因: session.history IPC 拉历史 → prependSessionHistory 把 N 条历史 events
  // (含若干 session_complete) 全塞 eventsBySession[sid]。lastNotifiedEventIdxRef 是
  // in-memory ref, 进程重启就丢 → 首次见到 sid 时 lastIdx=-1 → 从 0 扫所有 events →
  // **每条历史 session_complete 都触发通知** (用 history user msg.sentAt 算 elapsed,
  // 跟 Date.now() 差很大 → 远超 60s threshold → 通过 → 弹通知)。
  //
  // 修法: 首次见到该 sid 时把 cursor 调到末尾, 跳过 history 回放阶段产生的所有 events,
  // 只对后续真正新增的 events 触发通知。
  useEffect(() => {
    for (const [sid, events] of Object.entries(eventsBySession)) {
      if (events.length === 0) continue;
      if (!lastNotifiedEventIdxRef.current.has(sid)) {
        // 首次见到 sid: 把 cursor 直接调到末尾, 跳过 history replay (和首屏已有的
        // in-flight events)。后续 events 增长才会被检测。
        lastNotifiedEventIdxRef.current.set(sid, events.length - 1);
        continue;
      }
      const lastNotifiedIdx = lastNotifiedEventIdxRef.current.get(sid) ?? -1;
      for (let i = lastNotifiedIdx + 1; i < events.length; i++) {
        const ev = events[i];
        if (ev.kind !== 'session_complete' && ev.kind !== 'session_error') continue;
        lastNotifiedEventIdxRef.current.set(sid, i);
        void maybeNotify(sid, ev.kind === 'session_complete' ? 'complete' : 'error', sessions);
      }
    }
  }, [eventsBySession, sessions]);
}

async function maybeNotify(
  sessionId: string,
  outcome: 'complete' | 'error',
  sessions: ReadonlyArray<{ readonly sessionId: string; readonly title?: string }>,
): Promise<void> {
  // 取得 elapsed
  const userMsgs = useAppStore.getState().userMessagesBySession[sessionId] ?? [];
  const lastMsg = userMsgs[userMsgs.length - 1];
  if (!lastMsg?.sentAt) return; // 没起点不算 long task
  const elapsedMs = Date.now() - lastMsg.sentAt;
  if (elapsedMs < LONG_TASK_THRESHOLD_MS) return;

  // 窗口在前台 → 用户已在看，不通知
  if (typeof document !== 'undefined' && !document.hidden && document.hasFocus()) return;

  if (!window.kodaxSpace) return;
  const session = sessions.find((s) => s.sessionId === sessionId);
  const title = session?.title ?? 'KodaX Space';
  const elapsedLabel = formatElapsed(elapsedMs);
  const body =
    outcome === 'complete'
      ? `Session done · ${elapsedLabel}`
      : `Session failed · ${elapsedLabel}`;

  await window.kodaxSpace
    .invoke('notification.show', {
      title,
      body,
      sessionId,
      silent: false,
    })
    .catch(() => {
      // notify 失败 → 静默；in-app NotificationsSurface 已经在显示
    });
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const m2 = min % 60;
  return m2 > 0 ? `${hr}h ${m2}m` : `${hr}h`;
}

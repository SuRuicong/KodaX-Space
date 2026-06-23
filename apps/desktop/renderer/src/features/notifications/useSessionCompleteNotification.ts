import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore.js';
import {
  formatElapsed,
  isFreshLivePromptStart,
  shouldNotifyForCompletion,
  type CompletionFocusSnapshot,
} from './sessionCompleteNotificationModel.js';

interface ActivePromptRecord {
  readonly startedAt: number;
}

interface SessionLite {
  readonly sessionId: string;
  readonly title?: string;
}

/**
 * Native OS completion notifications are intentionally driven by live session_start events.
 * Restored history can contain terminal events with old user-message timestamps; without a
 * live start marker those events must never create a new toast.
 */
export function useSessionCompleteNotification(): void {
  const eventsBySession = useAppStore((s) => s.eventsBySession);
  const userMessagesBySession = useAppStore((s) => s.userMessagesBySession);
  const sessions = useAppStore((s) => s.sessions);
  const nativeEnabled = useAppStore((s) => s.nativeCompletionNotificationsEnabled);

  const activePromptRef = useRef<Map<string, ActivePromptRecord>>(new Map());
  const livePromptStartRef = useRef<Map<string, ActivePromptRecord>>(new Map());
  const lastSeenEventIdxRef = useRef<Map<string, number>>(new Map());
  const seenUserMessageCountRef = useRef<Map<string, number>>(new Map());
  const nativeEnabledRef = useRef(nativeEnabled);

  useEffect(() => {
    nativeEnabledRef.current = nativeEnabled;
  }, [nativeEnabled]);

  useEffect(() => {
    for (const [sessionId, messages] of Object.entries(userMessagesBySession)) {
      const previousCount = seenUserMessageCountRef.current.get(sessionId);
      seenUserMessageCountRef.current.set(sessionId, messages.length);

      if (
        messages.length === 0 ||
        (previousCount !== undefined && messages.length <= previousCount)
      ) {
        livePromptStartRef.current.delete(sessionId);
        continue;
      }

      const last = messages[messages.length - 1];
      if (last?.sentAt && isFreshLivePromptStart(last.sentAt)) {
        livePromptStartRef.current.set(sessionId, { startedAt: last.sentAt });
      } else {
        livePromptStartRef.current.delete(sessionId);
      }
    }
  }, [userMessagesBySession]);

  useEffect(() => {
    for (const [sessionId, events] of Object.entries(eventsBySession)) {
      let lastSeenIdx = lastSeenEventIdxRef.current.get(sessionId) ?? -1;
      if (lastSeenIdx >= events.length) {
        lastSeenIdx = -1;
        activePromptRef.current.delete(sessionId);
      }

      for (let i = lastSeenIdx + 1; i < events.length; i++) {
        const event = events[i];
        if (!event) continue;

        if (event.kind === 'session_start') {
          const livePromptStart = livePromptStartRef.current.get(sessionId);
          if (livePromptStart) {
            activePromptRef.current.set(sessionId, livePromptStart);
          }
          continue;
        }

        if (event.kind !== 'session_complete' && event.kind !== 'session_error') continue;
        if (event.kind === 'session_error' && event.error === 'cancelled') {
          activePromptRef.current.delete(sessionId);
          continue;
        }

        const activePrompt = activePromptRef.current.get(sessionId);
        activePromptRef.current.delete(sessionId);
        livePromptStartRef.current.delete(sessionId);
        if (!activePrompt) continue;

        void maybeNotify({
          sessionId,
          outcome: event.kind === 'session_complete' ? 'complete' : 'error',
          startedAt: activePrompt.startedAt,
          sessions,
          nativeEnabled: nativeEnabledRef.current,
        });
      }

      lastSeenEventIdxRef.current.set(sessionId, events.length - 1);
    }
  }, [eventsBySession, sessions]);
}

async function maybeNotify(input: {
  readonly sessionId: string;
  readonly outcome: 'complete' | 'error';
  readonly startedAt: number;
  readonly sessions: ReadonlyArray<SessionLite>;
  readonly nativeEnabled: boolean;
}): Promise<void> {
  const now = Date.now();
  if (!shouldNotifyForCompletion({ startedAt: input.startedAt, now, focus: getFocusSnapshot() })) {
    return;
  }

  const session = input.sessions.find((s) => s.sessionId === input.sessionId);
  const title = session?.title ?? 'KodaX Space';
  const elapsedLabel = formatElapsed(now - input.startedAt);
  const body =
    input.outcome === 'complete'
      ? `Session done - ${elapsedLabel}`
      : `Session failed - ${elapsedLabel}`;

  useAppStore.getState().pushNotification({
    id: `session-terminal:${input.sessionId}:${input.startedAt}:${input.outcome}`,
    severity: input.outcome === 'complete' ? 'info' : 'error',
    text:
      input.outcome === 'complete'
        ? `Session done: ${title} (${elapsedLabel})`
        : `Session failed: ${title} (${elapsedLabel})`,
    sessionId: input.sessionId,
    createdAt: now,
    dismissOnOutsideInteraction: true,
  });

  if (!input.nativeEnabled || !window.kodaxSpace) return;

  await window.kodaxSpace
    .invoke('notification.show', {
      title,
      body,
      sessionId: input.sessionId,
      silent: false,
    })
    .catch(() => {
      // The in-app notification above remains dismissible even if the OS toast fails.
    });
}

function getFocusSnapshot(): CompletionFocusSnapshot {
  if (typeof document === 'undefined') return { hidden: false, focused: true };
  return { hidden: document.hidden, focused: document.hasFocus() };
}

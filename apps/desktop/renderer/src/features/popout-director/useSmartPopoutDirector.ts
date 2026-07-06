import { useEffect } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../../store/appStore.js';
import { useSurfaceStore } from '../../store/surface.js';
import { requestTaskDockFocus } from '../../shell/taskDockControl.js';
import { decideAutoPromote, type SmartPopoutKind } from './rules.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const EMPTY_PROMOTED: ReadonlySet<SmartPopoutKind> = new Set<SmartPopoutKind>();
const RELEVANT_EVENT_LOOKBACK = 32;

interface UseSmartPopoutDirectorArgs {
  readonly activePopout: string | null;
}

export function useSmartPopoutDirector({ activePopout }: UseSmartPopoutDirectorArgs): void {
  const enabled = useAppStore((s) => s.smartPopoutEnabled);
  const surfaceIsCode = useSurfaceStore((s) => s.currentSurface === 'code');
  const sessionId = useAppStore((s) => s.currentSessionId);
  const latestRelevantEvent = useAppStore((s) => {
    if (!sessionId) return null;
    const events = s.eventsBySession[sessionId];
    if (!events || events.length === 0) return null;
    const start = Math.max(0, events.length - RELEVANT_EVENT_LOOKBACK);
    for (let i = events.length - 1; i >= start; i--) {
      const event = events[i];
      if (!event) continue;
      if (event.kind === 'todo_update' || event.kind === 'tool_start') return event;
      if (event.kind === 'session_start') break;
    }
    return null;
  });
  const promoted = useAppStore((s) =>
    sessionId
      ? ((s.promotedPopoutsBySession[sessionId] ?? EMPTY_PROMOTED) as ReadonlySet<SmartPopoutKind>)
      : EMPTY_PROMOTED,
  );
  const markPromoted = useAppStore((s) => s.markPopoutPromoted);

  useEffect(() => {
    if (!enabled || !surfaceIsCode || sessionId === null) return;
    const events = latestRelevantEvent ? [latestRelevantEvent] : EMPTY_EVENTS;
    const decision = decideAutoPromote({ events, activePopout, promoted });
    if (decision === null) return;

    markPromoted(sessionId, decision);
    requestTaskDockFocus(decision === 'plan' ? 'plan' : 'changes');
  }, [
    activePopout,
    enabled,
    latestRelevantEvent,
    markPromoted,
    promoted,
    sessionId,
    surfaceIsCode,
  ]);
}

// KX-I-02 Smart Popout Director — React hook that runs the pure rules against
// the current session's event stream and auto-opens plan/diff/tasks popouts
// when their first relevant signal arrives.
//
// Lifecycle:
//   - Mounted at the top of Shell (alongside the activePopout state)
//   - Reads events for currentSessionId from store via selector
//   - Each render runs decideAutoPromote(events, activePopout, promoted)
//   - Non-null result → calls onPromote(kind) + marks promoted
//
// 副作用纯单向 (events change → maybe set popout); 没有内部 state。
// hook 不持有 React.state — 任何 "已 promoted" 记账走 store.markPopoutPromoted。

import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { decideAutoPromote, type SmartPopoutKind } from './rules.js';

const EMPTY_EVENTS: readonly SessionEvent[] = [];
const EMPTY_PROMOTED: ReadonlySet<SmartPopoutKind> = new Set<SmartPopoutKind>();

interface UseSmartPopoutDirectorArgs {
  /** 当前 active popout (Shell state)。非 null 时 director 不会 promote。 */
  readonly activePopout: string | null;
  /** Shell setActivePopout setter。命中 promote 时被调。 */
  readonly setActivePopout: (kind: SmartPopoutKind) => void;
}

export function useSmartPopoutDirector({
  activePopout,
  setActivePopout,
}: UseSmartPopoutDirectorArgs): void {
  const enabled = useAppStore((s) => s.smartPopoutEnabled);
  const sessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    sessionId ? s.eventsBySession[sessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  // KX-I-02 review HIGH-2 fix: 只 subscribe **当前 session** 的 promoted Set 引用,而非
  // 整个 Map。这样别 session markPromoted 时 (会换 outer map 引用) 本 hook 不会被惊动重跑。
  // EMPTY_PROMOTED 是模块级稳定引用,sessionId === null 时 selector 不会每 render 新建。
  const promoted = useAppStore((s) =>
    sessionId
      ? ((s.promotedPopoutsBySession[sessionId] ?? EMPTY_PROMOTED) as ReadonlySet<SmartPopoutKind>)
      : EMPTY_PROMOTED,
  );
  const markPromoted = useAppStore((s) => s.markPopoutPromoted);

  useEffect(() => {
    if (!enabled) return;
    if (sessionId === null) return;
    const decision = decideAutoPromote({ events, activePopout, promoted });
    if (decision === null) return;
    // Mark first — 即便 setActivePopout 之后 trigger re-render,markPromoted 已经写进
    // store,下一帧 selector 拿到 prom 含 decision,decideAutoPromote 不会再 emit。
    markPromoted(sessionId, decision);
    setActivePopout(decision);
  }, [enabled, sessionId, events, activePopout, promoted, markPromoted, setActivePopout]);
}

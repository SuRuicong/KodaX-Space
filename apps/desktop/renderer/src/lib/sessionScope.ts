import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';

export interface SessionScope {
  readonly projectRoot?: string | null;
  readonly surface?: SessionMeta['surface'];
}

function isWindowsLike(): boolean {
  if (typeof navigator !== 'undefined') return /Windows/i.test(navigator.userAgent);
  return false;
}

function surfaceOf(session: SessionMeta): SessionMeta['surface'] {
  return session.surface ?? 'code';
}

export function sessionMatchesScope(
  session: SessionMeta,
  scope: SessionScope,
  isWindows = isWindowsLike(),
): boolean {
  if (scope.surface !== undefined && surfaceOf(session) !== scope.surface) return false;
  if (scope.projectRoot) {
    return canonProjectRoot(session.projectRoot, isWindows) === canonProjectRoot(scope.projectRoot, isWindows);
  }
  return true;
}

export function replaceSessionsInScope(
  existing: readonly SessionMeta[],
  incoming: readonly SessionMeta[],
  scope: SessionScope,
  isWindows = isWindowsLike(),
): readonly SessionMeta[] {
  if (!scope.projectRoot && scope.surface === undefined) return incoming;

  const incomingIds = new Set(incoming.map((s) => s.sessionId));
  const kept = existing.filter(
    (s) => !incomingIds.has(s.sessionId) && !sessionMatchesScope(s, scope, isWindows),
  );
  return [...incoming, ...kept];
}

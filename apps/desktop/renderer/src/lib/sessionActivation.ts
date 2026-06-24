import type { SessionMeta, Surface } from '@kodax-space/space-ipc-schema';
import { sessionMatchesScope } from './sessionScope.js';

export function shouldActivateSessionForCurrentScope(
  session: SessionMeta,
  scope: { readonly currentProjectPath: string | null; readonly currentSurface: Surface },
): boolean {
  return (
    scope.currentProjectPath !== null &&
    sessionMatchesScope(session, {
      projectRoot: scope.currentProjectPath,
      surface: scope.currentSurface,
    })
  );
}

// Back-compat shim for the original artifact-specific run context.
//
// Space-owned SDK tools now share one per-session run context so artifacts,
// Partner sources, and future Partner KB tools all read the same attribution
// boundary. Keep the old names for existing tests/imports.

import type { SessionRunContext } from '../kodax/session-run-context.js';

export type ArtifactRunContext = SessionRunContext;

export {
  withSessionRunContext as withArtifactContext,
  currentSessionRunContext as currentArtifactContext,
} from '../kodax/session-run-context.js';

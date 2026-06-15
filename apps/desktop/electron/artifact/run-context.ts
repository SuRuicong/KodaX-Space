// Per-run artifact attribution context (F058).
//
// A globally-registered tool handler (create_artifact) has no sessionId/surface
// in its KodaXToolExecutionContext. We carry them via AsyncLocalStorage: each
// run wraps sdk.runManagedTask in withArtifactContext({sessionId, surface}); the
// tool handler (executing within that run's async context) reads it. ALS is
// concurrency-safe — two sessions running in parallel each see their own context
// (a single module-global "active run" would be ambiguous under concurrency).

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ArtifactRunContext {
  sessionId: string;
  surface: 'code' | 'partner';
  /** The run's project root — used to scope-validate doc-kind artifact paths. */
  projectRoot: string;
}

const storage = new AsyncLocalStorage<ArtifactRunContext>();

/** Run `fn` with the given artifact attribution context bound for its async subtree. */
export function withArtifactContext<T>(ctx: ArtifactRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The active run's attribution context, or undefined when not inside withArtifactContext. */
export function currentArtifactContext(): ArtifactRunContext | undefined {
  return storage.getStore();
}

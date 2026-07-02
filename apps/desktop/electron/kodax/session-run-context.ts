import { AsyncLocalStorage } from 'node:async_hooks';
import type { Surface } from '@kodax-space/space-ipc-schema';
import type { KodaXToolExecutionContext } from '@kodax-ai/kodax/coding';

export interface SessionRunContext {
  sessionId: string;
  surface: Surface;
  projectRoot: string;
}

export type SdkToolExecutionContextLike = Pick<
  KodaXToolExecutionContext,
  'sessionId' | 'executionCwd' | 'gitRoot' | 'agentProfile'
>;

const storage = new AsyncLocalStorage<SessionRunContext>();

export function withSessionRunContext<T>(
  ctx: SessionRunContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentSessionRunContext(): SessionRunContext | undefined {
  return storage.getStore();
}

export function resolveSessionRunContext(
  toolContext?: SdkToolExecutionContextLike,
): SessionRunContext | undefined {
  const stored = storage.getStore();
  if (stored) return stored;

  const sessionId = toolContext?.sessionId;
  const surface = toolContext?.agentProfile?.surface;
  const projectRoot = toolContext?.executionCwd ?? toolContext?.gitRoot;
  if (!sessionId || !projectRoot) return undefined;
  if (surface !== 'partner' && surface !== 'code') return undefined;
  return { sessionId, surface, projectRoot };
}

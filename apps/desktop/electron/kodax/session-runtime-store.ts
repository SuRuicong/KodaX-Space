import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type {
  AgentMode,
  AutoModeEngine,
  PermissionMode,
  ReasoningMode,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';

const sessionRuntimeSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(128),
    permissionMode: z.enum(['plan', 'accept-edits', 'auto']).optional(),
    autoModeEngine: z.enum(['llm', 'rules']).optional(),
    reasoningMode: z.enum(['off', 'auto', 'quick', 'balanced', 'deep']).optional(),
    agentMode: z.enum(['ama', 'amaw', 'sa']).optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

export interface SessionRuntimeSettings {
  readonly permissionMode?: PermissionMode;
  readonly autoModeEngine?: AutoModeEngine;
  readonly reasoningMode?: ReasoningMode;
  readonly agentMode?: AgentMode;
}

interface SessionRuntimeFile extends SessionRuntimeSettings {
  readonly version: 1;
  readonly sessionId: string;
  readonly updatedAt: string;
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId);
}

export class SessionRuntimeStore {
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly dir = path.join(getSpaceDataDir(), 'session-runtime')) {}

  private filePath(sessionId: string): string | null {
    if (!isSafeSessionId(sessionId)) return null;
    return path.join(this.dir, `${sessionId}.json`);
  }

  async read(sessionId: string): Promise<SessionRuntimeSettings | null> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return null;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = sessionRuntimeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.sessionId !== sessionId) return null;
      return {
        ...(parsed.data.permissionMode !== undefined
          ? { permissionMode: parsed.data.permissionMode }
          : {}),
        ...(parsed.data.autoModeEngine !== undefined
          ? { autoModeEngine: parsed.data.autoModeEngine }
          : {}),
        ...(parsed.data.reasoningMode !== undefined
          ? { reasoningMode: parsed.data.reasoningMode }
          : {}),
        ...(parsed.data.agentMode !== undefined ? { agentMode: parsed.data.agentMode } : {}),
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        console.warn(`[SessionRuntimeStore] read failed for ${sessionId}:`, e.message);
      }
      return null;
    }
  }

  async set(sessionId: string, patch: SessionRuntimeSettings): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return;
    await this.enqueueSessionWrite(sessionId, () => this.setUnlocked(sessionId, filePath, patch));
  }

  private async setUnlocked(
    sessionId: string,
    filePath: string,
    patch: SessionRuntimeSettings,
  ): Promise<void> {
    try {
      const previous = await this.read(sessionId);
      const merged = { ...(previous ?? {}), ...patch };
      const next: SessionRuntimeFile = {
        version: 1,
        sessionId,
        ...(merged.permissionMode !== undefined ? { permissionMode: merged.permissionMode } : {}),
        ...(merged.autoModeEngine !== undefined ? { autoModeEngine: merged.autoModeEngine } : {}),
        ...(merged.reasoningMode !== undefined ? { reasoningMode: merged.reasoningMode } : {}),
        ...(merged.agentMode !== undefined ? { agentMode: merged.agentMode } : {}),
        updatedAt: new Date().toISOString(),
      };
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 });
      try {
        await fs.rename(tmp, filePath);
      } catch (err) {
        const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
        if (code === 'EEXIST' || code === 'EPERM') {
          await fs.copyFile(tmp, filePath);
          await fs.unlink(tmp).catch(() => {});
        } else {
          await fs.unlink(tmp).catch(() => {});
          throw err;
        }
      }
    } catch (err) {
      console.warn(
        `[SessionRuntimeStore] persist failed for ${sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.filePath(sessionId);
    if (!filePath) return;
    await this.enqueueSessionWrite(sessionId, async () => {
      await fs.rm(filePath, { force: true }).catch((err: unknown) => {
        console.warn(
          `[SessionRuntimeStore] delete failed for ${sessionId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    });
  }

  private async enqueueSessionWrite(sessionId: string, op: () => Promise<void>): Promise<void> {
    const previous = this.writeLocks.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(op);
    this.writeLocks.set(sessionId, next);
    try {
      await next;
    } finally {
      if (this.writeLocks.get(sessionId) === next) {
        this.writeLocks.delete(sessionId);
      }
    }
  }
}

const defaultSessionRuntimeStore = new SessionRuntimeStore();
let activeSessionRuntimeStore: SessionRuntimeStore = defaultSessionRuntimeStore;

export function getSessionRuntimeStore(): SessionRuntimeStore {
  return activeSessionRuntimeStore;
}

export function setSessionRuntimeStoreForTesting(store: SessionRuntimeStore | null): void {
  activeSessionRuntimeStore = store ?? defaultSessionRuntimeStore;
}

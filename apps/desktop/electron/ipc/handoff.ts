import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import type { HandoffFileT } from '@kodax-space/space-ipc-schema';

export const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let watcher: fs.FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

function handoffDir(): string {
  return path.join(os.homedir(), '.kodax', 'handoffs');
}

function handoffIdFromFile(filePath: string): string {
  return path.basename(filePath).replace(/\.json$/i, '');
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function createdAtField(obj: Record<string, unknown>, fallback: number): number {
  const value = obj.createdAt ?? obj.created_at ?? obj.timestamp;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return Math.floor(fallback);
}

export async function readHandoffFile(filePath: string, now = Date.now()): Promise<HandoffFileT> {
  const id = handoffIdFromFile(filePath);
  try {
    const [raw, stat] = await Promise.all([fsp.readFile(filePath, 'utf8'), fsp.stat(filePath)]);
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) throw new Error('handoff JSON must be an object');

    const sessionId = stringField(parsed, ['sessionId', 'session_id']);
    const projectRoot = stringField(parsed, ['projectRoot', 'project_root', 'cwd', 'workspace']);
    const source = stringField(parsed, ['source', 'from']);
    const createdAt = createdAtField(parsed, stat.mtimeMs);

    if (!sessionId) throw new Error('missing sessionId');
    if (!projectRoot) throw new Error('missing projectRoot/cwd');

    const stale = now - createdAt > HANDOFF_MAX_AGE_MS;
    return {
      id,
      filePath,
      status: stale ? 'stale' : 'valid',
      sessionId,
      projectRoot,
      source,
      createdAt,
      ...(stale ? { error: 'handoff is older than 24 hours' } : {}),
    };
  } catch (err) {
    return {
      id,
      filePath,
      status: 'invalid',
      sessionId: null,
      projectRoot: null,
      source: null,
      createdAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listHandoffsInDir(dir: string, now = Date.now()): Promise<readonly HandoffFileT[]> {
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(dir, entry.name));
  const handoffs = await Promise.all(files.map((file) => readHandoffFile(file, now)));
  return handoffs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

async function findHandoffInDir(dir: string, id: string, now = Date.now()): Promise<HandoffFileT | null> {
  const handoffs = await listHandoffsInDir(dir, now);
  return handoffs.find((handoff) => handoff.id === id) ?? null;
}

async function removeHandoffFile(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function acceptHandoffInDir(
  dir: string,
  input: { readonly handoffId: string; readonly expectedSessionId?: string },
  now = Date.now(),
): Promise<{
  readonly accepted: boolean;
  readonly removed: boolean;
  readonly sessionId?: string;
  readonly projectRoot?: string;
  readonly error?: string;
}> {
  const handoff = await findHandoffInDir(dir, input.handoffId, now);
  if (!handoff) return { accepted: false, removed: false, error: 'handoff not found' };
  if (handoff.status !== 'valid' || !handoff.sessionId || !handoff.projectRoot) {
    return {
      accepted: false,
      removed: false,
      error: handoff.error ?? `handoff is ${handoff.status}`,
    };
  }
  if (input.expectedSessionId && input.expectedSessionId !== handoff.sessionId) {
    return {
      accepted: false,
      removed: false,
      error: `handoff changed before accept: ${handoff.sessionId}`,
    };
  }
  const removed = await removeHandoffFile(handoff.filePath);
  return {
    accepted: true,
    removed,
    sessionId: handoff.sessionId,
    projectRoot: handoff.projectRoot,
    ...(!removed ? { error: 'accepted but failed to remove handoff file' } : {}),
  };
}

export async function dismissHandoffInDir(
  dir: string,
  input: { readonly handoffId: string },
  now = Date.now(),
): Promise<{ readonly dismissed: boolean; readonly removed: boolean; readonly error?: string }> {
  const handoff = await findHandoffInDir(dir, input.handoffId, now);
  if (!handoff) return { dismissed: false, removed: false, error: 'handoff not found' };
  const removed = await removeHandoffFile(handoff.filePath);
  return {
    dismissed: removed,
    removed,
    ...(!removed ? { error: 'failed to remove handoff file' } : {}),
  };
}

function scheduleChangedPush(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void listHandoffsInDir(handoffDir())
      .then((handoffs) => pushToRenderer('handoff.changed', { handoffs: [...handoffs] }))
      .catch((err) => {
        console.warn('[handoff] list after watch failed:', err instanceof Error ? err.message : err);
      });
  }, 200);
}

function startHandoffWatcher(): void {
  if (watcher) return;
  void fsp.mkdir(handoffDir(), { recursive: true }).then(() => {
    if (watcher) return;
    watcher = fs.watch(handoffDir(), { persistent: false }, scheduleChangedPush);
    watcher.on('error', (err) => {
      console.warn('[handoff] watch failed:', err instanceof Error ? err.message : err);
      watcher?.close();
      watcher = null;
    });
    scheduleChangedPush();
  }).catch((err) => {
    console.warn('[handoff] mkdir failed:', err instanceof Error ? err.message : err);
  });
}

export function registerHandoffChannels(): void {
  startHandoffWatcher();

  registerChannel('handoff.list', async () => ({ handoffs: [...(await listHandoffsInDir(handoffDir()))] }));

  registerChannel('handoff.accept', async (input) => {
    const result = await acceptHandoffInDir(handoffDir(), input);
    scheduleChangedPush();
    return result;
  });

  registerChannel('handoff.dismiss', async (input) => {
    const result = await dismissHandoffInDir(handoffDir(), input);
    scheduleChangedPush();
    return result;
  });
}

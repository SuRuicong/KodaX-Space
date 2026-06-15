// ArtifactStore (F057) — persists Space-owned artifacts to
// ~/.kodax/space/artifacts.json. Space stores artifacts itself (零 native; the
// 路径 D 决策),不依赖 LC / SDK 存储。
//
// Design mirrors ProjectStore: in-memory cache + write-through, write-lock
// serialized read-modify-write, atomic write (tmp → rename), schema-validated
// load (corrupt file → start empty, never throw), DI constructor for tests.
//
// Content (text/code/html/svg/chart-json/react/image-data-uri) is stored inline
// per version, capped at MAX_ARTIFACT_CONTENT_BYTES. Doc kinds (pdf/docx/xlsx)
// store only a file `path` reference (the binary lives on disk in scope) — no
// large binaries are inlined. list() returns content-stripped metadata; full
// content is fetched per version via read().

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  artifactKindSchema,
  MAX_ARTIFACT_CONTENT_BYTES,
  ARTIFACT_MAX_VERSIONS as MAX_VERSIONS,
  type ArtifactKindT,
  type ArtifactRefT,
} from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from '../kodax/data-paths.js';

const SPACE_DATA_DIR = getSpaceDataDir();
const ARTIFACTS_FILE = path.join(SPACE_DATA_DIR, 'artifacts.json');
const MAX_ARTIFACTS = 1000; // hard backstop against unbounded growth

const storedVersionSchema = z.object({
  v: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES).optional(),
  path: z.string().max(4096).optional(),
  summary: z.string().max(512).optional(),
});

const storedArtifactSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  surface: z.enum(['code', 'partner']),
  kind: artifactKindSchema,
  title: z.string().min(1).max(256),
  currentVersion: z.number().int().positive(),
  versions: z.array(storedVersionSchema).min(1).max(MAX_VERSIONS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const fileSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(storedArtifactSchema),
});

export type StoredArtifact = z.infer<typeof storedArtifactSchema>;

export interface UpsertInput {
  sessionId: string;
  surface: 'code' | 'partner';
  kind: ArtifactKindT;
  title: string;
  content?: string;
  path?: string;
  summary?: string;
  /** When set + found, append a version (iterate) instead of creating new. */
  id?: string;
}

export interface ReadResult {
  ref: ArtifactRefT;
  version: number;
  content?: string;
  path?: string;
}

function toMeta(a: StoredArtifact): ArtifactRefT {
  return {
    id: a.id,
    sessionId: a.sessionId,
    surface: a.surface,
    kind: a.kind,
    title: a.title,
    currentVersion: a.currentVersion,
    versions: a.versions.map((v) => ({
      v: v.v,
      createdAt: v.createdAt,
      hasContent: typeof v.content === 'string',
      ...(v.path !== undefined ? { path: v.path } : {}),
      ...(v.summary !== undefined ? { summary: v.summary } : {}),
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export class ArtifactStore {
  private cached: StoredArtifact[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = ARTIFACTS_FILE,
    private readonly dir: string = SPACE_DATA_DIR,
  ) {}

  private async loadAll(): Promise<StoredArtifact[]> {
    if (this.cached) return this.cached;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ArtifactStore] ${this.filePath} schema invalid, starting empty:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        this.cached = [];
      } else {
        this.cached = parsed.data.artifacts;
      }
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[ArtifactStore] read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.cached = [];
    }
    return this.cached;
  }

  /**
   * Create a new artifact, or append a version when `input.id` matches an
   * existing one. Returns `created` so callers can classify the change:
   *   - id matches existing → append version, created=false
   *   - no id, OR id provided but NOT found → new artifact with a FRESH id,
   *     created=true. (A stale/deleted id is NOT resurrected — you get a new
   *     artifact, never a silent un-delete of the old one.)
   */
  async upsert(input: UpsertInput): Promise<{ id: string; version: number; created: boolean }> {
    if (input.content !== undefined && Buffer.byteLength(input.content, 'utf8') > MAX_ARTIFACT_CONTENT_BYTES) {
      throw new Error('artifact content exceeds size limit');
    }
    return this.mutate<{ id: string; version: number; created: boolean }>((list) => {
      const now = Date.now();
      const newVersion = (content?: string, p?: string, summary?: string, v = 1) => ({
        v,
        createdAt: now,
        ...(content !== undefined ? { content } : {}),
        ...(p !== undefined ? { path: p } : {}),
        ...(summary !== undefined ? { summary } : {}),
      });

      if (input.id !== undefined) {
        const idx = list.findIndex((a) => a.id === input.id);
        if (idx >= 0) {
          const prev = list[idx]!;
          if (prev.versions.length >= MAX_VERSIONS) {
            throw new Error(`artifact ${prev.id} reached max ${MAX_VERSIONS} versions`);
          }
          const v = prev.currentVersion + 1;
          const next: StoredArtifact = {
            ...prev,
            title: input.title || prev.title,
            currentVersion: v,
            versions: [...prev.versions, newVersion(input.content, input.path, input.summary, v)],
            updatedAt: now,
          };
          const copy = [...list];
          copy[idx] = next;
          return { list: copy, ret: { id: next.id, version: v, created: false } };
        }
        // id provided but not found → create a NEW artifact (fresh id), don't
        // reuse the stale id (avoids resurrecting a concurrently-deleted one).
      }

      if (list.length >= MAX_ARTIFACTS) {
        throw new Error(`artifact store reached max ${MAX_ARTIFACTS} entries`);
      }
      const id = randomUUID();
      const created: StoredArtifact = {
        id,
        sessionId: input.sessionId,
        surface: input.surface,
        kind: input.kind,
        title: input.title,
        currentVersion: 1,
        versions: [newVersion(input.content, input.path, input.summary, 1)],
        createdAt: now,
        updatedAt: now,
      };
      return { list: [created, ...list], ret: { id, version: 1, created: true } };
    });
  }

  async list(filter?: { sessionId?: string; surface?: 'code' | 'partner' }): Promise<ArtifactRefT[]> {
    const all = await this.loadAll();
    return all
      .filter((a) => (filter?.sessionId ? a.sessionId === filter.sessionId : true))
      .filter((a) => (filter?.surface ? a.surface === filter.surface : true))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toMeta);
  }

  async read(id: string, version?: number): Promise<ReadResult | null> {
    const all = await this.loadAll();
    const a = all.find((x) => x.id === id);
    if (!a) return null;
    const v = version ?? a.currentVersion;
    const ver = a.versions.find((x) => x.v === v);
    if (!ver) return null;
    return {
      ref: toMeta(a),
      version: v,
      ...(ver.content !== undefined ? { content: ver.content } : {}),
      ...(ver.path !== undefined ? { path: ver.path } : {}),
    };
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate((list) => {
      const next = list.filter((a) => a.id !== id);
      return { list: next, ret: next.length !== list.length };
    });
  }

  /** Test hook: drop cache to force a re-read from disk. */
  invalidate(): void {
    this.cached = null;
  }

  /** Serialize read-modify-write so concurrent callers don't clobber each other. */
  private async mutate<R>(
    apply: (list: StoredArtifact[]) => { list: StoredArtifact[]; ret: R },
  ): Promise<R> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const current = await this.loadAll();
      const { list, ret } = apply([...current]);
      this.cached = list;
      await this.persistLocked(list);
      return ret;
    } finally {
      release();
    }
  }

  private async persistLocked(list: StoredArtifact[]): Promise<void> {
    // mode 0o700/0o600: artifacts may contain user content. POSIX user-only.
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ version: 1, artifacts: list });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
    try {
      // POSIX rename is atomic overwrite. Windows rename throws EEXIST/EPERM when
      // the target exists → fall back to copyFile (keeps the old file in place
      // until the copy completes, so a concurrent reader never sees no file),
      // then drop the tmp. Re-throw any other error code with the tmp cleaned up.
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
      if (code === 'EEXIST' || code === 'EPERM') {
        await fs.copyFile(tmp, this.filePath);
        await fs.unlink(tmp).catch(() => {});
      } else {
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
    }
  }
}

export const artifactStore = new ArtifactStore();

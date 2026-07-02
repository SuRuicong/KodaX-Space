import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { getSpaceDataDir } from './data-paths.js';

const MAX_KB_PAGES_PER_PROJECT = 512;
export const MAX_PARTNER_KB_CONTENT_CHARS = 512_000;

const pageSchema = z.object({
  id: z.string().min(1).max(128),
  projectRoot: z.string().min(1).max(4096),
  slug: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  content: z.string().max(MAX_PARTNER_KB_CONTENT_CHARS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const fileSchema = z.object({
  version: z.literal(1),
  pages: z.array(pageSchema).max(100_000),
});

export type PartnerKbPage = z.infer<typeof pageSchema>;

export interface PartnerKbWriteInput {
  readonly projectRoot: string;
  readonly title: string;
  readonly content: string;
  readonly slug?: string;
}

function normalizeSlug(input: string): string {
  const ascii = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return ascii || `page-${randomUUID().slice(0, 8)}`;
}

function sameProject(a: string, b: string): boolean {
  return canonProjectRoot(a, process.platform === 'win32') === canonProjectRoot(b, process.platform === 'win32');
}

async function atomicWriteJson(filePath: string, value: z.infer<typeof fileSchema>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
    if (code === 'EEXIST' || code === 'EPERM') {
      await fs.copyFile(tmp, filePath);
      await fs.unlink(tmp).catch(() => {});
      return;
    }
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

export class PartnerKbStore {
  private cached: PartnerKbPage[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string = path.join(getSpaceDataDir(), 'partner-kb.json')) {}

  async list(projectRoot: string): Promise<PartnerKbPage[]> {
    const all = await this.load();
    return all
      .filter((page) => sameProject(page.projectRoot, projectRoot))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(projectRoot: string, selector: { readonly id?: string; readonly slug?: string }): Promise<PartnerKbPage | null> {
    const all = await this.load();
    return (
      all.find((page) => {
        if (!sameProject(page.projectRoot, projectRoot)) return false;
        if (selector.id && page.id === selector.id) return true;
        if (selector.slug && page.slug === normalizeSlug(selector.slug)) return true;
        return false;
      }) ?? null
    );
  }

  async upsert(input: PartnerKbWriteInput): Promise<{ page: PartnerKbPage; created: boolean }> {
    const title = input.title.trim();
    const content = input.content;
    if (!title) throw new Error('title is required');
    if (!content.trim()) throw new Error('content is required');
    if (content.length > MAX_PARTNER_KB_CONTENT_CHARS) {
      throw new Error(`content exceeds ${MAX_PARTNER_KB_CONTENT_CHARS} characters`);
    }
    const slug = normalizeSlug(input.slug ?? title);
    return this.mutate<{ page: PartnerKbPage; created: boolean }>((current) => {
      const idx = current.findIndex(
        (page) => sameProject(page.projectRoot, input.projectRoot) && page.slug === slug,
      );
      const now = Date.now();
      if (idx >= 0) {
        const prev = current[idx]!;
        const page: PartnerKbPage = {
          ...prev,
          title,
          content,
          updatedAt: now,
        };
        const next = [...current];
        next[idx] = page;
        return { next, result: { page, created: false } };
      }
      const projectCount = current.filter((page) => sameProject(page.projectRoot, input.projectRoot)).length;
      if (projectCount >= MAX_KB_PAGES_PER_PROJECT) {
        throw new Error(`Partner KB page limit reached for this project (${MAX_KB_PAGES_PER_PROJECT})`);
      }
      const page: PartnerKbPage = {
        id: `kb_${randomUUID()}`,
        projectRoot: input.projectRoot,
        slug,
        title,
        content,
        createdAt: now,
        updatedAt: now,
      };
      return { next: [...current, page], result: { page, created: true } };
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<PartnerKbPage[]> {
    if (this.cached !== null) return [...this.cached];
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[PartnerKbStore] ${this.filePath} schema invalid, starting empty:`,
          parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        );
        this.cached = [];
      } else {
        this.cached = parsed.data.pages;
      }
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[PartnerKbStore] read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.cached = [];
    }
    return [...this.cached];
  }

  private async mutate<R>(
    apply: (current: PartnerKbPage[]) => { next: PartnerKbPage[]; result: R },
  ): Promise<R> {
    const previous = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.load();
      const { next, result } = apply([...current]);
      this.cached = next;
      await atomicWriteJson(this.filePath, { version: 1, pages: next });
      return result;
    } finally {
      release();
    }
  }
}

export const partnerKbStore = new PartnerKbStore();

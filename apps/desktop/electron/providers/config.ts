// Provider 配置持久化 — FEATURE_004
//
// 两个独立文件：
//   ~/.kodax/space/provider-config.json   Space 自己的（默认 provider id 等）
//   ~/.kodax/custom-providers.json        与 KodaX CLI 共享的自定义 provider 列表
//
// 拆开的理由：
//   - "默认 provider" 是 Space 的 UX 状态，不该污染 KodaX CLI 的配置文件
//   - 自定义 provider 跟 KodaX 共享——CLI 跑 `kodax run` 时 KodaX runtime 也能识别
//     这些 provider（要求 KodaX 端读这个文件，本期由 Space 单独写，CLI 集成待 chore）
//
// 写法与 ProjectStore / PermissionRegistry 同款：
//   - 原子写 tmp → rename + Windows EEXIST/EPERM 退避重试
//   - 文件 0o600 / 目录 0o700
//   - schema 损坏不抛——log + 回滚空配置

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { isBuiltinId } from './catalog.js';

const SPACE_CONFIG_DIR = path.join(os.homedir(), '.kodax', 'space');
const SPACE_CONFIG_FILE = path.join(SPACE_CONFIG_DIR, 'provider-config.json');

const KODAX_DIR = path.join(os.homedir(), '.kodax');
const CUSTOM_PROVIDERS_FILE = path.join(KODAX_DIR, 'custom-providers.json');

// ---- Space 自己的 provider 配置 ----

const spaceConfigSchema = z.object({
  version: z.literal(1),
  defaultProviderId: z.string().min(1).max(64).nullable(),
});

type SpaceConfig = z.infer<typeof spaceConfigSchema>;

// ---- 自定义 provider 列表 ----
//
// id 由 main 生成（"custom_<8 hex>"）——不接受用户指定。
// apiKeyEnv 由用户填写——允许复用 built-in env（如多个 Anthropic-compat 自建网关
// 都用 ANTHROPIC_API_KEY），但同一 apiKeyEnv 在同一时间只能注入一个值；
// 用户切默认 provider 时会重新注入对应 key。
const customProviderSchema = z.object({
  id: z.string().min(1).max(64).regex(/^custom_[a-f0-9]{8,}$/),
  displayName: z.string().min(1).max(128),
  protocol: z.enum(['anthropic', 'openai']),
  baseUrl: z.string().url().max(512),
  apiKeyEnv: z.string().min(1).max(128),
  defaultModel: z.string().min(1).max(128),
  models: z.array(z.string().min(1).max(128)).max(64).optional(),
  createdAt: z.number().int().nonnegative(),
});

export type CustomProvider = z.infer<typeof customProviderSchema>;

const customProvidersFileSchema = z.object({
  version: z.literal(1),
  providers: z.array(customProviderSchema).max(64), // 64 个自定义 provider 上限——防 LLM 诱导反复 addCustom
});

// ---- ProviderConfigStore ----

export class ProviderConfigStore {
  private spaceCache: SpaceConfig | null = null;
  private customCache: CustomProvider[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly spaceFile: string = SPACE_CONFIG_FILE,
    private readonly spaceDir: string = SPACE_CONFIG_DIR,
    private readonly customFile: string = CUSTOM_PROVIDERS_FILE,
    private readonly customDir: string = KODAX_DIR,
  ) {}

  async load(): Promise<void> {
    if (this.spaceCache === null) this.spaceCache = await this.readSpaceConfig();
    if (this.customCache === null) this.customCache = await this.readCustomProviders();
  }

  getDefaultProviderId(): string | null {
    return this.spaceCache?.defaultProviderId ?? null;
  }

  listCustom(): readonly CustomProvider[] {
    return this.customCache ? this.customCache.slice() : [];
  }

  getCustom(id: string): CustomProvider | undefined {
    return this.customCache?.find((p) => p.id === id);
  }

  async setDefault(providerId: string): Promise<void> {
    await this.mutateSpace((cfg) => ({ ...cfg, defaultProviderId: providerId }));
  }

  async clearDefault(): Promise<void> {
    await this.mutateSpace((cfg) => ({ ...cfg, defaultProviderId: null }));
  }

  /**
   * 新增自定义 provider，生成稳定 id。
   * id 格式 `custom_<8 hex>`——保证不与 built-in id（kebab-case 字母）冲突。
   */
  async addCustom(p: Omit<CustomProvider, 'id' | 'createdAt'>): Promise<string> {
    const id = `custom_${randomHex(8)}`;
    const entry: CustomProvider = { ...p, id, createdAt: Date.now() };
    await this.mutateCustom((rules) => [...rules, entry]);
    return id;
  }

  async removeCustom(id: string): Promise<boolean> {
    if (isBuiltinId(id)) return false; // built-in 不可删
    let removed = false;
    await this.mutateCustom((rules) => {
      const next = rules.filter((r) => {
        if (r.id === id) {
          removed = true;
          return false;
        }
        return true;
      });
      return next;
    });
    return removed;
  }

  // ---- internal ----

  private async readSpaceConfig(): Promise<SpaceConfig> {
    try {
      const raw = await fs.readFile(this.spaceFile, 'utf-8');
      const parsed = spaceConfigSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ProviderConfigStore] ${this.spaceFile} schema invalid, defaulting:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        return { version: 1, defaultProviderId: null };
      }
      return parsed.data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          `[ProviderConfigStore] failed to read ${this.spaceFile}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      return { version: 1, defaultProviderId: null };
    }
  }

  private async readCustomProviders(): Promise<CustomProvider[]> {
    try {
      const raw = await fs.readFile(this.customFile, 'utf-8');
      const parsed = customProvidersFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ProviderConfigStore] ${this.customFile} schema invalid, defaulting empty:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        return [];
      }
      return parsed.data.providers.slice();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          `[ProviderConfigStore] failed to read ${this.customFile}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      return [];
    }
  }

  private mutateSpace(apply: (cfg: SpaceConfig) => SpaceConfig): Promise<void> {
    const next = this.writeLock.then(async () => {
      if (this.spaceCache === null) this.spaceCache = await this.readSpaceConfig();
      const updated = apply(this.spaceCache);
      this.spaceCache = updated;
      await persistAtomic(this.spaceDir, this.spaceFile, JSON.stringify(updated, null, 2));
    });
    this.writeLock = next.catch(() => undefined);
    return next;
  }

  private mutateCustom(apply: (providers: CustomProvider[]) => CustomProvider[]): Promise<void> {
    const next = this.writeLock.then(async () => {
      if (this.customCache === null) this.customCache = await this.readCustomProviders();
      const updated = apply(this.customCache);
      this.customCache = updated.slice();
      const payload: z.infer<typeof customProvidersFileSchema> = {
        version: 1,
        providers: updated,
      };
      await persistAtomic(this.customDir, this.customFile, JSON.stringify(payload, null, 2));
    });
    this.writeLock = next.catch(() => undefined);
    return next;
  }
}

// ---- shared atomic-write helper（与 PermissionRegistry / ProjectStore 同款逻辑） ----

async function persistAtomic(dir: string, filePath: string, data: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 });
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.rename(tmp, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
      }
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
    }
  }
  await fs.unlink(tmp).catch(() => undefined);
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`[ProviderConfigStore] rename failed after retries: ${String(lastErr)}`);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Node 18 fallback
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 进程单例。main 启动时调一次 load()。*/
export const providerConfigStore = new ProviderConfigStore();

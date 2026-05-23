// SettingsStore — alpha.1
//
// Space-level user settings 持久化在 ~/.kodax/space/settings.json。与 projectStore
// 兄弟文件，同 JSON 原子写模式（write tmp + rename）。
//
// 当前仅一项：defaultWorkspace —— 用户的"workspace home"，
// 类似 IDE 默认工作目录。新 session 不再要求显式选 folder：
//   - 用户首次启动 → store 给 fallback ~/kodax_workspace + 自动 mkdir -p
//   - 用户改默认 → 通过 Settings UI 写回这里
//
// 这里**只**写标量配置 — secrets / API keys 走 keychain，永远不进 settings.json。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

const SPACE_DATA_DIR = path.join(os.homedir(), '.kodax', 'space');
const SETTINGS_FILE = path.join(SPACE_DATA_DIR, 'settings.json');

const fileSchema = z.object({
  version: z.literal(1),
  defaultWorkspace: z.string().min(1).max(4096),
});

export type SpaceSettings = z.infer<typeof fileSchema>;

const DEFAULT_WORKSPACE = path.join(os.homedir(), 'kodax_workspace');

export class SettingsStore {
  private cached: SpaceSettings | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = SETTINGS_FILE,
    private readonly dir: string = SPACE_DATA_DIR,
  ) {}

  async load(): Promise<SpaceSettings> {
    if (this.cached) return { ...this.cached };
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.cached = parsed.data;
        return { ...this.cached };
      }
      console.warn(`[SettingsStore] ${this.filePath} schema invalid, falling back to defaults`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        console.warn(`[SettingsStore] read failed (${e.code}), falling back to defaults`);
      }
    }
    // Fallback
    this.cached = { version: 1, defaultWorkspace: DEFAULT_WORKSPACE };
    return { ...this.cached };
  }

  /**
   * 确保 defaultWorkspace 目录存在 — main 启动期一次，让 renderer 直接拿来用。
   * 用户改默认目录后也要再调一次以创建新目录（用户可能输了不存在的路径）。
   */
  async ensureWorkspaceExists(): Promise<void> {
    const s = await this.load();
    try {
      await fs.mkdir(s.defaultWorkspace, { recursive: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      console.warn(
        `[SettingsStore] mkdir defaultWorkspace="${s.defaultWorkspace}" failed (${e.code}): ${e.message}`,
      );
    }
  }

  async setDefaultWorkspace(absPath: string): Promise<SpaceSettings> {
    const cur = await this.load();
    const next: SpaceSettings = { ...cur, defaultWorkspace: absPath };
    this.cached = next;
    // serialize 写
    this.writeLock = this.writeLock.then(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = this.filePath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
      await fs.rename(tmp, this.filePath);
    });
    await this.writeLock;
    return { ...next };
  }
}

export const settingsStore = new SettingsStore();

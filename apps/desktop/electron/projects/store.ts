// ProjectStore — 持久化"用户最近打开的项目"到 ~/.kodax/space/projects.json。
//
// 设计：
//   - 单一文件，原子写（写 tmp → rename），防进程中途崩了损坏 JSON
//   - 内存缓存 + write-through——读频率远高于写
//   - 不存绝对路径以外的任何元数据（不缓存 git status / file count 等可变状态）
//   - schema 损坏时不抛错，回滚到空列表 + 旁路 log

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

// 注：与 KodaX CLI 共享 ~/.kodax 根，但 Space 自己的目录是 ~/.kodax/space/。
// 与 KodaX session JSONL 完全隔离，避免一方误删另一方文件。
const SPACE_DATA_DIR = path.join(os.homedir(), '.kodax', 'space');
const PROJECTS_FILE = path.join(SPACE_DATA_DIR, 'projects.json');

const fileSchema = z.object({
  version: z.literal(1),
  projects: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      addedAt: z.number().int().nonnegative(),
      lastUsedAt: z.number().int().nonnegative(),
    }),
  ),
});

export type Project = z.infer<typeof fileSchema>['projects'][number];

export class ProjectStore {
  private cached: Project[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = PROJECTS_FILE,
    private readonly dir: string = SPACE_DATA_DIR,
  ) {}

  async list(): Promise<Project[]> {
    if (this.cached) return [...this.cached];
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[ProjectStore] ${this.filePath} schema invalid, starting empty:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        this.cached = [];
      } else {
        this.cached = parsed.data.projects;
      }
    } catch (err) {
      // ENOENT = 首次启动；其他错误也按"启动空列表"处理，写新文件时会覆盖
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        console.warn(
          '[ProjectStore] read failed, starting empty:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.cached = [];
    }
    return [...this.cached];
  }

  /**
   * 加入或刷新最近项目。已存在的 path 只更新 lastUsedAt，不改 addedAt / name。
   * 返回更新后的 Project 对象。
   */
  async addOrBump(absPath: string): Promise<Project> {
    const list = await this.list();
    const now = Date.now();
    const existingIdx = list.findIndex((p) => p.path === absPath);
    let project: Project;
    if (existingIdx >= 0) {
      project = { ...list[existingIdx], lastUsedAt: now };
      list[existingIdx] = project;
    } else {
      project = {
        path: absPath,
        name: path.basename(absPath) || absPath,
        addedAt: now,
        lastUsedAt: now,
      };
      list.unshift(project);
    }
    this.cached = list;
    await this.persist(list);
    return project;
  }

  async remove(absPath: string): Promise<boolean> {
    const list = await this.list();
    const before = list.length;
    const next = list.filter((p) => p.path !== absPath);
    if (next.length === before) return false;
    this.cached = next;
    await this.persist(next);
    return true;
  }

  /** 测试用：丢内存 cache 强制下次 list 重新读盘。*/
  invalidate(): void {
    this.cached = null;
  }

  private async persist(list: Project[]): Promise<void> {
    // serialise writes —— 不让并发写互相覆盖
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const payload = JSON.stringify({ version: 1, projects: list }, null, 2);
      const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, payload, 'utf-8');
      await fs.rename(tmp, this.filePath);
    } finally {
      release();
    }
  }
}

// 单例。main 端各 handler 通过 import 这个实例操作。
// 测试时也可以 new ProjectStore(tmpPath) 用独立路径，但建议直接复用单例 + invalidate()。
export const projectStore = new ProjectStore();

/** 测试用：可注入自定义路径的 store。*/
export function createProjectStore(filePath: string, dir: string): ProjectStore {
  return new ProjectStore(filePath, dir);
}

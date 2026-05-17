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
import { validateProjectRoot } from '../ipc/validate.js';

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
        // 文件可能被外部（别的进程 / 攻击者 / 手工编辑）写入畸形 path——
        // schema 只确保字符串；不验证语义。这里再过一遍 validateProjectRoot 把
        // 非绝对 / 含 .. / 含 NUL 的条目 drop 掉。filename basename 是显示用的，
        // 不影响实际打开行为（实际打开走 IPC 边界还会再 validate 一次）。
        this.cached = parsed.data.projects.filter((p) => {
          try {
            validateProjectRoot(p.path);
            return true;
          } catch (err) {
            console.warn(
              `[ProjectStore] dropping invalid entry: ${err instanceof Error ? err.message : String(err)}`,
            );
            return false;
          }
        });
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
    return this.mutate((list) => {
      const now = Date.now();
      const existingIdx = list.findIndex((p) => p.path === absPath);
      if (existingIdx >= 0) {
        const project: Project = { ...list[existingIdx], lastUsedAt: now };
        list[existingIdx] = project;
        return { list, ret: project };
      }
      const project: Project = {
        path: absPath,
        name: path.basename(absPath) || absPath,
        addedAt: now,
        lastUsedAt: now,
      };
      list.unshift(project);
      return { list, ret: project };
    });
  }

  async remove(absPath: string): Promise<boolean> {
    return this.mutate((list) => {
      const before = list.length;
      const next = list.filter((p) => p.path !== absPath);
      if (next.length === before) return { list, ret: false };
      return { list: next, ret: true };
    });
  }

  /** 测试用：丢内存 cache 强制下次 list 重新读盘。*/
  invalidate(): void {
    this.cached = null;
  }

  /**
   * 串行化"读-改-写"。两个并发 caller 必须按 enqueue 顺序拿到最新 cache 再修改，
   * 不能各自 snapshot 然后最后写的赢——那样会丢前面的写。
   *
   * 实现：把整个"读 cache + apply mutation + persist"塞进同一个 lock，
   * lock 用 promise 链。每个调用排到链尾，wait 前一个完成后再跑。
   */
  private async mutate<R>(
    apply: (list: Project[]) => { list: Project[]; ret: R },
  ): Promise<R> {
    const prev = this.writeLock;
    let release: () => void = () => {};
    this.writeLock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const current = await this.list();
      const { list, ret } = apply([...current]); // copy 防 mutation 泄露
      this.cached = list;
      await this.persistLocked(list);
      return ret;
    } finally {
      release();
    }
  }

  /** 已经持锁的写入。**不**自己再持锁——只能从 mutate() 调。*/
  private async persistLocked(list: Project[]): Promise<void> {
    // mode 0o700 / 0o600：projects.json 含用户项目路径，可能泄露 proprietary 代码名等。
    // Windows 忽略 mode，POSIX 强制 user-only。
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ version: 1, projects: list }, null, 2);
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, payload, { encoding: 'utf-8', mode: 0o600 });

    // POSIX 的 rename 是原子覆盖；Windows 的 rename 在目标存在时会 EEXIST / EPERM。
    // 用 fallback：rename 失败就改 copyFile + unlink（牺牲严格原子性换跨平台）。
    try {
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
      if (code === 'EEXIST' || code === 'EPERM') {
        await fs.copyFile(tmp, this.filePath);
        await fs.unlink(tmp).catch(() => {
          /* 删 tmp 失败不影响主写——下次启动会被覆盖 */
        });
      } else {
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
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

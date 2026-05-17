// PermissionRegistry — 持久化 always-allow 规则到 ~/.kodax/permissions.json
//
// 设计：
//   - 与 KodaX CLI 共享同一目录 ~/.kodax/ 但用独立文件 permissions.json
//     （KodaX CLI 的 confirmTools / allowPatterns 概念后续可以双向同步——本期不做）
//   - 原子写：tmp → rename；防中途崩损
//   - 文件权限 0o600 / 目录 0o700（与 ProjectStore 一致——多用户系统下避免信息泄漏）
//   - 内存缓存 + write-through——matches() 在 tool 调用前路径，必须毫秒级
//   - schema 损坏不 throw：log + 回滚到空规则集，让应用能起来；用户再次批准会重写文件
//
// matches() 走 risk.ts 的 matchesPattern：模式仅有
//   - "<tool>"             整工具批准
//   - "<tool>:<prefix>"    bash 系限定第一 token

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { matchesPattern } from './risk.js';

const PERMISSIONS_DIR = path.join(os.homedir(), '.kodax');
const PERMISSIONS_FILE = path.join(PERMISSIONS_DIR, 'permissions.json');

const ruleSchema = z.object({
  pattern: z.string().min(1).max(512),
  createdAt: z.number().int().nonnegative(),
});

// review L2-sec：rules 数组上限 1000——防止 LLM 反复诱导用户 allow_always 后
// permissions.json 无限增长（matches() 是线性扫描，10k+ 规则会拖慢每次工具调用）。
// 实际场景一个用户 10 条规则就算多，1000 留足够 buffer 且不构成 DoS
const MAX_RULES = 1000;
const fileSchema = z.object({
  version: z.literal(1),
  rules: z.array(ruleSchema).max(MAX_RULES),
});

export type PermissionRule = z.infer<typeof ruleSchema>;

export class PermissionRegistry {
  private cached: PermissionRule[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string = PERMISSIONS_FILE,
    private readonly dir: string = PERMISSIONS_DIR,
  ) {}

  /** 读到内存缓存（首次访问触发；后续 matches/list 都走缓存）。*/
  async load(): Promise<void> {
    if (this.cached !== null) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.warn(
          `[PermissionRegistry] ${this.filePath} schema invalid, starting empty:`,
          parsed.error.issues.map((i) => i.path.join('.')).join(', '),
        );
        this.cached = [];
      } else {
        this.cached = parsed.data.rules.slice();
      }
    } catch (err) {
      // ENOENT 正常 — 首次启动还没有文件
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cached = [];
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[PermissionRegistry] failed to read ${this.filePath}: ${msg}`);
        this.cached = [];
      }
    }
  }

  /**
   * 检查是否有规则覆盖该次调用。**同步**——必须先 load() 过。
   * 用同步是因为 KodaX permission callback 在 tool 调用前的同步路径，
   * 调用方 await load() 一次后 matches 走纯内存查找。
   */
  matches(toolName: string, input: Record<string, unknown> | undefined): boolean {
    if (!this.cached) {
      // load 没跑过 — 不知道是否允许，按未授权处理（永远偏严）
      return false;
    }
    return this.cached.some((r) => matchesPattern(r.pattern, toolName, input));
  }

  /** 列出所有规则。返回拷贝，调用方不能间接改 cached。*/
  list(): readonly PermissionRule[] {
    return this.cached ? this.cached.slice() : [];
  }

  /**
   * 新增一条 always-allow 规则。pattern 已存在则更新 createdAt（重复批准视为续约）。
   * load() 必须先跑过。
   *
   * review H1-code（2026-05-17）：完全 immutable 更新——与 remove() 的 filter 风格一致，
   * 避免 cached 与 mutate 回调入参同引用的潜在 bug
   */
  async add(pattern: string): Promise<void> {
    await this.mutate((rules) => {
      const next = { pattern, createdAt: Date.now() };
      const idx = rules.findIndex((r) => r.pattern === pattern);
      if (idx >= 0) {
        return [...rules.slice(0, idx), next, ...rules.slice(idx + 1)];
      }
      // review L2-sec：达到上限时丢弃最老的（FIFO 淘汰），保证总条数恒定 ≤ MAX_RULES
      if (rules.length >= MAX_RULES) {
        // 按 createdAt 升序排，删最老的；保留 MAX_RULES-1 条 + 本次新增 = MAX_RULES
        const sorted = [...rules].sort((a, b) => a.createdAt - b.createdAt);
        return [...sorted.slice(1), next];
      }
      return [...rules, next];
    });
  }

  /**
   * 删除规则。返回是否删除成功（pattern 不存在时返回 false）。
   */
  async remove(pattern: string): Promise<boolean> {
    let removed = false;
    await this.mutate((rules) => {
      const next = rules.filter((r) => {
        if (r.pattern === pattern) {
          removed = true;
          return false;
        }
        return true;
      });
      return next;
    });
    return removed;
  }

  /**
   * 读-改-写 在同一 promise chain 锁下串行执行。
   * 与 ProjectStore.mutate 同样模式——防止两次 add() 并发时丢失一条。
   */
  private mutate(apply: (rules: PermissionRule[]) => PermissionRule[]): Promise<void> {
    const next = this.writeLock.then(async () => {
      if (this.cached === null) await this.load();
      const current = this.cached ? this.cached.slice() : [];
      const updated = apply(current);
      this.cached = updated.slice();
      await this.persistLocked(updated);
    });
    // 失败也要让后续 mutate 不卡住
    this.writeLock = next.catch(() => undefined);
    return next;
  }

  /**
   * 原子写：tmp → rename。锁内调用。
   *
   * review H2-sec（2026-05-17）：Windows EEXIST/EPERM fallback 之前用
   * copyFile + unlink，copyFile 本身不原子——并发 load 时可能读到半写文件。
   * 现在改成"短暂重试 rename"：Windows 上 EEXIST/EPERM 通常是目标被 av/IDE 短暂占用，
   * 50ms 后重试 3 次几乎总能成功。仍失败则抛错让上层重试整个 mutate。
   */
  private async persistLocked(rules: PermissionRule[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const payload: z.infer<typeof fileSchema> = { version: 1, rules };
    const data = JSON.stringify(payload, null, 2);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 });

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM') {
          // 清理 tmp 防止泄漏
          await fs.unlink(tmp).catch(() => undefined);
          throw err;
        }
        lastErr = err;
        // 指数退避：50ms → 100ms → 200ms（足以让 av / IDE 释放 lock）
        await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
      }
    }
    // 4 次仍失败——清理 tmp + 抛错
    await fs.unlink(tmp).catch(() => undefined);
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`[PermissionRegistry] rename failed after retries: ${String(lastErr)}`);
  }
}

/** 进程内单例。`registerPermissionChannels` / KodaXHost 都用这个 instance。*/
export const permissionRegistry = new PermissionRegistry();

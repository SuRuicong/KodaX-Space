// v0.1.10 chore: 清理早期版本 / 第三方残留的 `~/.kodax_space` 孤儿目录。
//
// 背景: Space 当前 source-of-truth 是 `~/.kodax/` (SDK 共享) + `~/.kodax/space/`
// (Space 独占)。grep 整个 repo 没有任何 `.kodax_space` 字面 (除本文件与 design doc),
// 但用户机器上可能仍有该目录,造成两个 Space-related 目录并存的混乱。
//
// 处理策略 — best-effort,**只删确认是 Electron userData 风的内容**:
//   - 探测到 Cache/ Cookies/ Local Storage/ IndexedDB/ GPUCache/ Preferences 等
//     组合特征 → 是 Electron userData 风,删
//   - 探测到 sessions/ config.json/ agents/ 等 KodaX SDK 数据风 → 保留 + warn
//   - 其它情况 (空目录 / 不认识的内容) → 保留 + warn
//
// 任何失败 (权限 / fs busy / 异常 stat) 都静默吞掉 — 启动期 best-effort 不能阻塞 UI。

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORPHAN_DIR = '.kodax_space';

/** Electron userData 子目录的判定特征。命中 ≥ 2 个就视为 userData。 */
const ELECTRON_USERDATA_MARKERS: ReadonlySet<string> = new Set([
  'Cache',
  'Cookies',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'GPUCache',
  'Preferences',
  'Network',
  'Code Cache',
  'blob_storage',
  'shared_proto_db',
]);

/** KodaX SDK 数据目录的判定特征。命中 ≥ 1 个就视为 KodaX 数据,保留。 */
const KODAX_DATA_MARKERS: ReadonlySet<string> = new Set([
  'sessions',
  'config.json',
  'agents',
  'instances',
  'commands',
  'skills',
  'auto-rules.jsonc',
  'AGENTS.md',
]);

export type CleanupResult =
  | { kind: 'not-found' }
  | { kind: 'removed-userdata'; entries: number }
  | { kind: 'kept-kodax-data'; entries: number; matched: readonly string[] }
  | { kind: 'kept-unknown'; entries: number; sample: readonly string[] }
  | { kind: 'error'; message: string };

/**
 * 检查并(必要时)删除孤儿 `~/.kodax_space`。pure-ish: 返结构化结果让 caller 决定 log/return。
 *
 * @param homeOverride 测试注入用;生产请传 undefined 走 os.homedir()。
 */
export async function cleanupOrphanKodaxSpaceDir(
  homeOverride?: string,
): Promise<CleanupResult> {
  try {
    const home = homeOverride ?? os.homedir();
    const orphan = path.join(home, ORPHAN_DIR);

    const stat = await fs.stat(orphan).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return { kind: 'not-found' };
    }

    const entries = await fs.readdir(orphan);
    const entrySet = new Set(entries);

    // 优先级 1: 命中 KodaX 数据标记 → 保留 (绝对安全)
    const kodaxMatched = [...KODAX_DATA_MARKERS].filter((m) => entrySet.has(m));
    if (kodaxMatched.length > 0) {
      return { kind: 'kept-kodax-data', entries: entries.length, matched: kodaxMatched };
    }

    // 优先级 2: 命中 ≥ 2 个 Electron userData 标记 → 删 (高把握不误伤)
    const userdataHits = [...ELECTRON_USERDATA_MARKERS].filter((m) => entrySet.has(m));
    if (userdataHits.length >= 2) {
      await fs.rm(orphan, { recursive: true, force: true });
      return { kind: 'removed-userdata', entries: entries.length };
    }

    // 优先级 3: 不认识 → 保留,把前几个 entry 名字带回去帮排查
    return {
      kind: 'kept-unknown',
      entries: entries.length,
      sample: entries.slice(0, 5),
    };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 给 main.ts 的 wrapper: 跑清理,console 输出结果。Never throws。 */
export async function cleanupOrphanKodaxSpaceDirWithLog(): Promise<void> {
  const result = await cleanupOrphanKodaxSpaceDir();
  switch (result.kind) {
    case 'not-found':
      return; // 静默 — 大多数用户走这条
    case 'removed-userdata':
      console.log(
        `[startup] Cleaned orphan ~/.kodax_space (Electron userData residue, ${result.entries} entries).`,
      );
      return;
    case 'kept-kodax-data':
      console.warn(
        `[startup] ~/.kodax_space contains KodaX SDK data (${result.matched.join(', ')}); leaving alone.`,
      );
      return;
    case 'kept-unknown':
      console.warn(
        `[startup] ~/.kodax_space exists but content unrecognized (${result.entries} entries, sample: ${result.sample.join(', ')}); leaving alone.`,
      );
      return;
    case 'error':
      console.warn(`[startup] Orphan ~/.kodax_space cleanup failed: ${result.message}`);
      return;
  }
}

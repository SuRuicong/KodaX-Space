// Data path resolution — OC-12 测试隔离
//
// 所有 Space 持久化目录 (~/.kodax/, ~/.kodax/space/) 在生产用 os.homedir()；
// 设了 `KODAX_TEST_ONBOARDING` env 时重定向到 os.tmpdir() 下的隔离 dir，
// 让 Playwright E2E 测首启流程不污染真实用户数据。
//
// 用法：
//   KODAX_TEST_ONBOARDING=1                 → tmpdir/kodax-test-<uuid> (每次 process 启动新 uuid)
//   KODAX_TEST_ONBOARDING=<id>              → tmpdir/kodax-test-<id>     (确定性，便于 fixture 复用)
//
// 为啥不让每个 store 自己读 env：
//   1. 共享一份缓存目录 —— 多个 store 在同一 process 里读出来必须是同路径
//   2. 集中变更：未来 OC-04 Crashpad / OC-10 secret-redact 都基于这两个目录定位
//
// HLD §16 Playwright E2E S1-S7 首启用例直接依赖本工具。

import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let cachedTestKodaxDir: string | null = null;

function resolveTestKodaxDir(rawEnv: string): string {
  if (cachedTestKodaxDir !== null) return cachedTestKodaxDir;
  // '1' / 'true' / 'on' 当作"给我生成一个 uuid"；其他值原样用，方便 fixture 显式命名
  const wantsAuto = rawEnv === '1' || rawEnv.toLowerCase() === 'true' || rawEnv.toLowerCase() === 'on';
  const suffix = wantsAuto ? randomUUID() : rawEnv;
  cachedTestKodaxDir = path.join(os.tmpdir(), `kodax-test-${suffix}`);
  return cachedTestKodaxDir;
}

/**
 * `~/.kodax/` —— 与 KodaX CLI 共享。SDK 自己也在这里写 sessions / config / agents。
 * 测试模式下重定向到 tmpdir/kodax-test-<id>/。
 */
export function getKodaxDir(): string {
  const testEnv = process.env.KODAX_TEST_ONBOARDING;
  if (testEnv && testEnv.length > 0) return resolveTestKodaxDir(testEnv);
  return path.join(os.homedir(), '.kodax');
}

/**
 * `~/.kodax/space/` —— Space 独占（projects.json / settings.json / log / etc.）。
 * 测试模式下重定向到 tmpdir/kodax-test-<id>/space/。
 */
export function getSpaceDataDir(): string {
  return path.join(getKodaxDir(), 'space');
}

/**
 * 测试 hook：清掉 cache 让下次读重新解析（unit test 模拟 env 切换时用）。
 * 生产路径不该用。
 */
export function _resetDataPathsCacheForTesting(): void {
  cachedTestKodaxDir = null;
}

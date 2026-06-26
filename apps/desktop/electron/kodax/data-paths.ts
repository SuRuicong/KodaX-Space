// Data path resolution — OC-12 测试隔离
//
// 所有 Space 持久化目录 (~/.kodax/, ~/.kodax/space/) 默认用 os.homedir()；
// 设了 `KODAX_TEST_ONBOARDING` env 时重定向到 os.tmpdir() 下的隔离 dir，
// 让 Playwright E2E 测首启流程不污染真实用户数据。
// electron-builder portable 启动时会设置 PORTABLE_EXECUTABLE_DIR；此时数据
// 跟随 exe 目录，避免便携版仍落到系统用户目录。
//
// 用法：
//   KODAX_TEST_ONBOARDING=1                 → tmpdir/kodax-test-<uuid> (每次 process 启动新 uuid)
//   KODAX_TEST_ONBOARDING=<id>              → tmpdir/kodax-test-<id>     (确定性，便于 fixture 复用)
//   KODAX_PORTABLE_DATA_DIR=<abs>           → <abs>/.kodax               (显式便携数据根)
//   PORTABLE_EXECUTABLE_DIR=<abs>           → <abs>/.kodax               (electron-builder portable)
//
// 为啥不让每个 store 自己读 env：
//   1. 共享一份缓存目录 —— 多个 store 在同一 process 里读出来必须是同路径
//   2. 集中变更：未来 OC-04 Crashpad / OC-10 secret-redact 都基于这两个目录定位
//
// HLD §16 Playwright E2E S1-S7 首启用例直接依赖本工具。

import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let cachedKodaxDir: string | null = null;

const SAFE_TEST_SUFFIX_RE = /^[A-Za-z0-9_-]{1,128}$/;

function resolveTestKodaxDir(rawEnv: string): string {
  // '1' / 'true' / 'on' 当作"给我生成一个 uuid"；其他值原样用，方便 fixture 显式命名
  const wantsAuto =
    rawEnv === '1' || rawEnv.toLowerCase() === 'true' || rawEnv.toLowerCase() === 'on';
  if (!wantsAuto && !SAFE_TEST_SUFFIX_RE.test(rawEnv)) {
    throw new Error('KODAX_TEST_ONBOARDING must be 1/true/on or a safe [A-Za-z0-9_-] suffix');
  }
  const suffix = wantsAuto ? randomUUID() : rawEnv;
  return path.join(os.tmpdir(), `kodax-test-${suffix}`);
}

function portableBaseDir(): string | null {
  const explicit = process.env.KODAX_PORTABLE_DATA_DIR;
  if (explicit && path.isAbsolute(explicit)) return explicit;
  const electronBuilderPortable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (electronBuilderPortable && path.isAbsolute(electronBuilderPortable))
    return electronBuilderPortable;
  return null;
}

/**
 * `~/.kodax/` —— 与 KodaX CLI 共享。SDK 自己也在这里写 sessions / config / agents。
 * 测试模式下重定向到 tmpdir/kodax-test-<id>/。
 */
export function getKodaxDir(): string {
  if (cachedKodaxDir !== null) return cachedKodaxDir;
  const testEnv = process.env.KODAX_TEST_ONBOARDING;
  if (testEnv && testEnv.length > 0) {
    cachedKodaxDir = resolveTestKodaxDir(testEnv);
    return cachedKodaxDir;
  }
  const portableDir = portableBaseDir();
  if (portableDir !== null) {
    cachedKodaxDir = path.join(portableDir, '.kodax');
    return cachedKodaxDir;
  }
  cachedKodaxDir = path.join(os.homedir(), '.kodax');
  return cachedKodaxDir;
}

/**
 * `~/.kodax/space/` —— Space 独占（projects.json / settings.json / log / etc.）。
 * 测试模式下重定向到 tmpdir/kodax-test-<id>/space/。
 */
export function getSpaceDataDir(): string {
  return path.join(getKodaxDir(), 'space');
}

/**
 * Electron userData 需要在便携/测试模式下跟随同一个数据根，否则 Chromium
 * 自己的缓存、单实例锁和 localStorage 仍会落到系统默认目录。
 */
export function getPortableOrTestUserDataDir(): string | null {
  if (process.env.KODAX_TEST_ONBOARDING) return path.join(getSpaceDataDir(), 'electron-user-data');
  if (portableBaseDir() !== null) return path.join(getSpaceDataDir(), 'electron-user-data');
  return null;
}

/**
 * 测试 hook：清掉 cache 让下次读重新解析（unit test 模拟 env 切换时用）。
 * 生产路径不该用。
 */
export function _resetDataPathsCacheForTesting(): void {
  cachedKodaxDir = null;
}

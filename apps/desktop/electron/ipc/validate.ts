// Boundary validators for IPC input.
//
// 这些校验是 zod schema 之外的"语义层"防御，例如 projectRoot 的路径形态。
// 单独成文件便于单元测试（不依赖 electron 运行时）。
//
// F005 v0.1.5：projectStore.assertAllowed(path) 是 allowlist 版校验
// （住在 projects/store.ts 是为了避免循环依赖 —— store 本身要 import validate）。

import path from 'node:path';

/**
 * 在 IPC 边界对 projectRoot 做**最小合法性校验**（不查 allowlist）：
 *   - 必须是绝对路径
 *   - normalize 后不能含 ".." 段
 *   - 不能含 NUL 字节
 *
 * 用于 path 还没进入 projectStore 的场景（如 project.recent.add 把新路径加进 allowlist）。
 * 其它"会触发文件读 / 子进程 spawn"的 handler 应当走 projectStore.assertAllowed —
 * 见 projects/store.ts。
 *
 * @returns normalized 后的安全字符串
 * @throws Error 含人类可读的拒绝原因（不含完整路径，避免日志泄露用户文件树）
 */
export function validateProjectRoot(input: string): string {
  if (/\x00/.test(input)) {
    throw new Error('projectRoot contains NUL byte');
  }
  if (!path.isAbsolute(input)) {
    throw new Error(`projectRoot must be absolute path, got: ${truncateForError(input)}`);
  }
  const normalized = path.normalize(input);
  if (normalized.split(/[\\/]/).includes('..')) {
    throw new Error(`projectRoot contains '..' after normalize: ${truncateForError(input)}`);
  }
  return normalized;
}

export function truncateForError(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

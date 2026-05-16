// Boundary validators for IPC input.
//
// 这些校验是 zod schema 之外的"语义层"防御，例如 projectRoot 的路径形态。
// 单独成文件便于单元测试（不依赖 electron 运行时）。

import path from 'node:path';

/**
 * 在 IPC 边界对 projectRoot 做最小合法性校验：
 *   - 必须是绝对路径
 *   - normalize 后不能含 ".." 段
 *   - 不能含 NUL 字节
 *
 * 注：这是**边界拒绝**而非**完整鉴权**。FEATURE_005 落地 Recent projects 白名单后
 * 再升级成"resolved path 必须在用户允许列表里"。当前只挡明显恶意输入。
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

function truncateForError(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

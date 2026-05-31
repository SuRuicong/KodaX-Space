// Schema validation helpers — OC-09 安全/可靠性
//
// `truncateZodError` 把 Zod 失败信息压缩成 envelope.details 安全形态：
//   1. 只保留每个 issue 的 { path, code, message }，剥掉 `received` / `expected`
//      等可能携带用户原始输入的字段 —— renderer 提交的 prompt 可达 1MB，
//      含粘贴的代码 / 不慎粘的 API key；如果整段进 details 就进 main 日志、IPC 回流、
//      崩溃报告，违反 PRD §7.1 "API key 永不进日志"。
//   2. 序列化后整体截到 maxLen 字符，避免 issue 数量爆炸（大对象多字段失败）拖垮日志。
//
// 调用方：register.ts (invoke 通道) 把入参 / 出参 ZodError.flatten() 改用本工具。

import type { ZodError } from 'zod';

const DEFAULT_MAX_LEN = 1024;

export interface SafeZodIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface SafeZodErrorDetails {
  readonly issues: readonly SafeZodIssue[];
  /** issues 序列化后超 maxLen 时为 true。telemetry / debug 用。*/
  readonly truncated: boolean;
  /** 原始 issues 数量（即使截断后剩 N 条也保留全量计数）。 */
  readonly totalIssues: number;
}

export function truncateZodError(err: ZodError, maxLen = DEFAULT_MAX_LEN): SafeZodErrorDetails {
  const allIssues: SafeZodIssue[] = err.issues.map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    // message 是 Zod 模板组装的描述（"Expected string, received number" 等），不含 raw value
    message: i.message,
  }));

  const totalIssues = allIssues.length;
  // 二分逼近最大子集，保证序列化后 <= maxLen；最少留 1 条 issue 让 debugger 有线索
  let lo = 0;
  let hi = allIssues.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const subset = allIssues.slice(0, mid);
    if (JSON.stringify(subset).length <= maxLen) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const kept = allIssues.slice(0, Math.max(best, 1));
  return {
    issues: kept,
    truncated: kept.length < totalIssues,
    totalIssues,
  };
}

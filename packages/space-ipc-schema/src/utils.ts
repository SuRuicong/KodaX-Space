// Schema validation helpers — OC-09 安全/可靠性
//
// `truncateZodError` 把 Zod 失败信息压缩成 envelope.details 安全形态：
//   1. 只保留每个 issue 的 { path, code, message }，剥掉 `received` / `expected`
//      等可能携带用户原始输入的字段 —— renderer 提交的 prompt 可达 1MB，
//      含粘贴的代码 / 不慎粘的 API key；如果整段进 details 就进 main 日志、IPC 回流、
//      崩溃报告，违反 PRD §7.1 "API key 永不进日志"。
//   2. **review CRITICAL fix**：两类 Zod issue.message 模板会直接嵌入用户原值：
//        - `invalid_enum_value`     → "Invalid enum value. Expected ..., received '<value>'"
//        - `unrecognized_keys`      → "Unrecognized key(s) in object: 'k1', 'k2'"
//      这两类 message 必须替换成静态文案，否则 path+code 走 safe 路径但 message
//      还在泄漏。其它码 (`invalid_type` / `too_small` / `too_big` / `invalid_string`)
//      message 模板里只含类型名 / 长度数字，安全保留。
//   3. 序列化后整体截到 maxLen 字符，避免 issue 数量爆炸（大对象多字段失败）拖垮日志。
//      单个 issue 自身超 maxLen 时 message 也会被截短，保证整体 <= maxLen。
//
// 调用方：register.ts (invoke 通道) 把入参 / 出参 ZodError.flatten() 改用本工具。

import type { ZodError, ZodIssueCode } from 'zod';

const DEFAULT_MAX_LEN = 1024;

// Zod issue.code 中 message 会嵌入用户原值的码 —— 必须替换 message 文案
const VALUE_LEAKING_CODES = new Set<ZodIssueCode>([
  'invalid_enum_value',
  'unrecognized_keys',
]);

// 替换后的静态文案 —— 让 debugger 仍能识别 issue 类型，但不携带用户值
const REDACTED_MESSAGE: Record<string, string> = {
  invalid_enum_value: 'value not in allowed enum (redacted)',
  unrecognized_keys: 'unrecognized key(s) (redacted)',
};

function safeMessage(code: ZodIssueCode, originalMessage: string): string {
  if (VALUE_LEAKING_CODES.has(code)) {
    return REDACTED_MESSAGE[code] ?? '(redacted)';
  }
  return originalMessage;
}

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
    // message 安全化 —— invalid_enum_value / unrecognized_keys 替成静态文案防泄漏
    message: safeMessage(i.code, i.message),
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
  let kept = allIssues.slice(0, Math.max(best, 1));

  // Edge case：即便只留 1 条 issue 也超 maxLen（path 极深 / 自定义 message 巨长）。
  // 截短 message 让单条也 <= maxLen，保证 truncated=true 时调用方相信"整体不超界"。
  if (kept.length === 1 && JSON.stringify(kept).length > maxLen) {
    const issue = kept[0];
    // 保留 path + code 完整，截 message —— path/code 短，message 是占大头的来源
    const skeleton = JSON.stringify({ path: issue.path, code: issue.code, message: '' });
    const messageBudget = Math.max(0, maxLen - skeleton.length - 4); // 4 = "…" + escape margin
    kept = [{
      ...issue,
      message: issue.message.length > messageBudget
        ? issue.message.slice(0, messageBudget) + '…'
        : issue.message,
    }];
  }

  return {
    issues: kept,
    truncated: kept.length < totalIssues,
    totalIssues,
  };
}

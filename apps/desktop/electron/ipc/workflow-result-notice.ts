// Workflow 结果历史提示条解析 —— 纯函数,无 electron/SDK 依赖,便于单测。
//
// SDK 把 workflow run 的最终结果/失败作为一条 `_synthetic` 的
// `<task-completed task_id="…">…</task-completed>` user 消息存进 session transcript(位置正确)。
// session.history handler 用本函数识别它、抽出可读正文,改发 `workflow_notice` 历史条,renderer
// **原位**渲染成 workflow system_notice —— 而不是把合成消息一律丢弃、再从侧存储按 wall-clock 重排
// (SDK 压缩会把 transcript 逐条时间戳压平,导致 workflow 通知在 resume 后乱序/置顶)。

/** 单条 workflow 结果 notice 正文的最大长度(避免把整份报告塞进一条 notice)。 */
export const TASK_COMPLETED_BODY_MAX = 2000;

/**
 * 识别 `<task-completed task_id="…">…</task-completed>` 块并格式化成可读的 workflow 提示条文本。
 * - 去掉包裹标签;
 * - 依正文粗判 completed / failed 加标签;
 * - 带上 runId;
 * - 截断到 TASK_COMPLETED_BODY_MAX。
 * 不是 task-completed 块时返回 undefined(调用方据此走原有 synthetic-skip 逻辑)。
 */
export function parseTaskCompletedNotice(text: string): string | undefined {
  const trimmed = text.trimStart();
  const open = /^<task-completed\s+task_id="([^"]*)"\s*>/.exec(trimmed);
  if (!open) return undefined;
  const runId = open[1] ?? '';
  let body = trimmed
    .slice(open[0].length)
    .replace(/<\/task-completed>\s*$/, '')
    .trim();
  const failed = /\[Tool Error\]|\bfailed\b/i.test(body.slice(0, 200));
  if (body.length > TASK_COMPLETED_BODY_MAX) {
    body = `${body.slice(0, TASK_COMPLETED_BODY_MAX).trimEnd()}\n…`;
  }
  const label = failed ? 'failed' : 'completed';
  const tag = runId ? ` · ${runId}` : '';
  return `[workflow] ${label}${tag}${body ? `\n${body}` : ''}`;
}

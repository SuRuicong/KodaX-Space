// Workflow 结果历史提示条解析 —— session.history 回放时把 SDK 存进 transcript 的
// `<task-completed>` 合成消息识别成 workflow 结果、原位渲染(见 ipc/session.ts + approach A)。
//
// ⚠️ 关键:`<task-completed task_id="…">…</task-completed>` 这个 wrapper **不是 workflow 独有**。
// SDK 的 enqueueChildTaskNotification 对**普通 dispatch_child_task** 的完成/失败也用同一个 wrapper
// (run_workflow 的结果只是"像 dispatched child 一样"晚到)。二者只有 task_id 不同:workflow 用
// Space 落盘的 runId(<space>/workflow-runs/<runId>/ 存在),dispatch_child_task 用任意 id、无落盘目录。
// 所以**必须**用 isWorkflowRunDir() 交叉核对 task_id 是不是真的 workflow run,否则普通子任务会被误标成
// `[workflow] completed/failed`(review 抓到的 HIGH)。

import { existsSync } from 'node:fs';
import path from 'node:path';

/** 单条 workflow 结果 notice 正文的最大长度(避免把整份报告塞进一条 notice)。 */
export const TASK_COMPLETED_BODY_MAX = 2000;

export interface TaskCompletedBlock {
  /** SDK 的 task_id(workflow 的 runId 或 dispatch 的任意 id)——调用方须用 isWorkflowRunDir 核对。 */
  readonly runId: string;
  /** 已格式化(completed/failed 标签 + runId + 去标签 + 截断)的可读正文。 */
  readonly text: string;
}

// 完整块:<task-completed task_id="…"> … </task-completed>。SDK 会把多条待发通知用空行拼进一条
// 合成消息,所以要 global 匹配**所有**块(review 抓到的 MEDIUM:只剥首尾会漏掉中间的标签)。
const BLOCK_RE = /<task-completed\s+task_id="([^"]*)"\s*>([\s\S]*?)<\/task-completed>/g;
// 兜底:被截断/缺收尾标签时,只认**开头**那个开标签(避免匹配正文里内联提到的 <task-completed>)。
const LEADING_OPEN_RE = /^<task-completed\s+task_id="([^"]*)"\s*>/;

function formatBlock(runId: string, rawBody: string): TaskCompletedBlock {
  let body = rawBody.trim();
  const failed = /\[Tool Error\]|\bfailed\b/i.test(body.slice(0, 200));
  if (body.length > TASK_COMPLETED_BODY_MAX) {
    body = `${body.slice(0, TASK_COMPLETED_BODY_MAX).trimEnd()}\n…`;
  }
  const label = failed ? 'failed' : 'completed';
  const tag = runId ? ` · ${runId}` : '';
  return { runId, text: `[workflow] ${label}${tag}${body ? `\n${body}` : ''}` };
}

/**
 * 解析一条合成消息里的**全部** `<task-completed>` 块(SDK 可能把多条批到一起)。每块单独返回、
 * 正文各自剥干净(不会把相邻块的标签留在中间)。返回块**未经** workflow 身份校验 —— 调用方须对每块
 * 的 runId 调 isWorkflowRunDir(),只对真 workflow run 出 notice。非 task-completed 内容返回 []。
 */
export function parseTaskCompletedBlocks(text: string): TaskCompletedBlock[] {
  const trimmed = text.trim();
  const out: TaskCompletedBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(trimmed)) !== null) {
    out.push(formatBlock(m[1] ?? '', m[2] ?? ''));
  }
  if (out.length === 0) {
    const open = LEADING_OPEN_RE.exec(trimmed);
    if (open) out.push(formatBlock(open[1] ?? '', trimmed.slice(open[0].length)));
  }
  return out;
}

// path-traversal 守卫:runId 只允许安全 token,否则不拿去拼路径。
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * 一条 `<task-completed>` 块是否真的是 Workflow Harness 的结果 —— 判据:它的 task_id 命名了一个
 * Space 落盘的 workflow run(`<runBaseDir>/<runId>/` 存在)。dispatch_child_task 用同样的 wrapper 但
 * **没有** run 目录,据此排除。副作用:极早期崩溃、未落盘的 run 会被当成非 workflow 跳过(安全方向:
 * 宁可漏显一条失败通知,也不把普通子任务误标成 workflow)。
 */
export function isWorkflowRunDir(runId: string, runBaseDir: string): boolean {
  if (!SAFE_RUN_ID_RE.test(runId)) return false;
  try {
    return existsSync(path.join(runBaseDir, runId));
  } catch {
    return false;
  }
}

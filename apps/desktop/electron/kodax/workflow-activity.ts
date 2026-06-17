// F065 子 agent 活动遥测——纯路由逻辑（从 real-session 抽出以便单测）。
//
// SDK 0.7.50 给 KodaXEvents 回调加了 workflowCorrelation 尾参。带 workflowRunId 的事件
// 来自工作流子 agent；Space 据此把事件归到 run + 子 agent，不淹主 transcript。

import type { WorkflowActivityPayload } from '@kodax-space/space-ipc-schema';

export type ChildMeta =
  | {
      workflowCorrelation?: { workflowRunId?: string; childAgentId?: string };
      childAgentId?: string;
      childAgentName?: string;
    }
  | undefined;

/** 取子 agent 事件的 workflowRunId；非工作流子事件（含 main agent 自身事件）返回 undefined。 */
export function childRunId(meta: ChildMeta): string | undefined {
  const runId = meta?.workflowCorrelation?.workflowRunId;
  return typeof runId === 'string' && runId.length > 0 ? runId : undefined;
}

/**
 * 构造一条子 agent 活动 payload；非子事件返回 null（调用方据此跳过 push）。
 * 仅 discrete 事件（tool_use/tool_result/end）调用——控 IPC 量，不逐 text delta 推。
 */
export function buildChildActivity(
  meta: ChildMeta,
  kind: 'tool_use' | 'tool_result' | 'end',
  extra: { toolName?: string },
): WorkflowActivityPayload | null {
  const runId = childRunId(meta);
  if (!runId) return null;
  const childAgentId = meta?.childAgentId ?? meta?.workflowCorrelation?.childAgentId;
  return {
    runId,
    ...(childAgentId ? { childAgentId } : {}),
    ...(meta?.childAgentName ? { childAgentName: meta.childAgentName } : {}),
    kind,
    ...(extra.toolName ? { toolName: extra.toolName } : {}),
  };
}

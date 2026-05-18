// ask-user IPC channels — FEATURE_032
//
// KodaX guardrail / ask_user_question tool 需要主动向用户提问。对应 KodaX 接口：
//   AutoModeAskUser = (call, reason, signals?) => Promise<'allow' | 'block'>
//
// Space 这一层做 IPC adapter：
//   main 收 KodaX askUser callback → askUserBroker.request 推 'askUser.request' push →
//   renderer 弹 modal → 用户点击 → 'askUser.reply' invoke → broker.resolve →
//   AutoModeAskUser Promise resolve → 给 KodaX 回 verdict。
//
// 跟 permission.request 的区别：
//   - permission.request 是"工具调用 gate"，每个 tool call 都过
//   - askUser.request 是"agent 主动问问题 / guardrail 升级到用户"，频次低、问题文本更自由
//
// 两者刻意分开 channel：避免一个超时策略 / 一个 modal queue 把另一个堵住；UI 端也可以
// 用不同视觉处理（permission modal 显示 input 字段，askUser modal 显示问题文本 + signals）。

import { z } from 'zod';

// ---- 信号 (FEATURE_158: signals 投影) ----
//
// KodaX FEATURE_158 引入 ToolCallSignal 给 askUser modal 用 (Scope/Risk 标签)。
// type/severity 闭集来自 KodaX；message 是人读字符串。
const askUserSignalSchema = z.object({
  type: z.string().min(1).max(64),
  severity: z.enum(['info', 'warning', 'danger']),
  message: z.string().max(512),
});

// ---- 工具调用快照 (RunnerToolCall subset) ----
//
// 不传 KodaX 内部的 RunnerToolCall 全字段（含 agentId / runId 等内部 token），
// 只暴露 UI 渲染需要的最小集 — review-style safe-by-default。
const askUserToolCallSchema = z.object({
  toolId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  // input 数据可能含敏感参数（path / command）——renderer 端 sanitize-for-display 再展示。
  input: z.record(z.unknown()).optional(),
});

// ---- Push: askUser.request ---- (main → renderer)
//
// renderer 监听 push，弹 AskUserModal 显示 reason + tool call + signals，
// 用户选择后通过 askUser.reply 回答 (用 reqId 关联)。
export const askUserRequestChannel = {
  name: 'askUser.request',
  direction: 'push',
  payload: z.object({
    reqId: z.string().min(1),
    sessionId: z.string().min(1),
    reason: z.string().min(1).max(2048),
    toolCall: askUserToolCallSchema,
    signals: z.array(askUserSignalSchema).max(20).optional(),
  }),
} as const;

// ---- Invoke: askUser.reply ---- (renderer → main)
//
// 用户点击 Allow / Block。
// 不传 reqId 错误 → handler 返回 { ok: false }，不抛错（防 renderer 拿不到答案永远等）。
export const askUserReplyChannel = {
  name: 'askUser.reply',
  direction: 'invoke',
  input: z.object({
    reqId: z.string().min(1),
    verdict: z.enum(['allow', 'block']),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Push: askUser.cancelled ---- (main → renderer)
//
// 推送时机：
//   - session 被 cancel / dispose（pending request 自动 block + 通知关 modal）
//   - 进程退出（cancelAll）
//   - 超时（默认 60s 无响应自动 block）
//
// renderer 收到后应当关闭对应 reqId 的 modal。reason 仅供日志展示。
export const askUserCancelledChannel = {
  name: 'askUser.cancelled',
  direction: 'push',
  payload: z.object({
    reqId: z.string().min(1),
    sessionId: z.string().min(1),
    reason: z.enum(['session_cancelled', 'session_disposed', 'shutdown', 'timeout']),
  }),
} as const;

export type AskUserVerdict = z.infer<typeof askUserReplyChannel.input>['verdict'];
export type AskUserSignal = z.infer<typeof askUserSignalSchema>;
export type AskUserToolCall = z.infer<typeof askUserToolCallSchema>;
export type AskUserRequestPayload = z.infer<typeof askUserRequestChannel.payload>;

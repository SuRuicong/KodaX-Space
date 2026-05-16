// Session lifecycle channels — FEATURE_003.
//
// Renderer → main 是 request/response（invoke）：create / send / cancel / list / delete
// Main → renderer 是 push 流：session.event（discriminated union by kind）
//
// Session.send 不直接返回 LLM 输出——它只是 ACK"我已接受并把这条 prompt 排进 session"。
// 实际 token / tool call / 结果通过 session.event push 实时推。

import { z } from 'zod';

// ---- Reasoning mode (镜像 @kodax-ai/llm 的 KodaXReasoningMode 闭集) ----
const reasoningModeSchema = z.enum(['off', 'auto', 'quick', 'balanced', 'deep']);

// ---- 尺寸上限：防 IPC 通道被超大 payload 拖垮（DoS / 内存炸） ----
//
// MAX_PROMPT_BYTES: 1 MB——比常见编辑器粘贴 + 整文件投喂的上限宽松，足以承载真实
//   "把这 N 个文件分析一下" 类 prompt。再大需要先切片。
// MAX_TEXT_CHUNK:  256 KB——单条 text_delta/thinking_delta 上限。LLM 流式返回里
//   每个 chunk 通常只有几十到几千字节，256 KB 留一个数量级缓冲。
// MAX_TOOL_RESULT: 512 KB——tool_result.content 比 text_delta 大一档：
//   `cat` 一个文件、`grep` 一片代码、http response body 都走这里。再大该工具
//   应该 truncate（KodaX 内核已经做这个）；schema 层兜底拒绝异常巨大值。
const MAX_PROMPT_BYTES = 1_048_576;
const MAX_TEXT_CHUNK = 262_144;
const MAX_TOOL_RESULT = 524_288;

// ---- Session metadata（list/create 返回） ----
const sessionMetaSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  provider: z.string().min(1),
  reasoningMode: reasoningModeSchema,
  createdAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
});

// ---- Invoke: session.create ----
export const sessionCreateChannel = {
  name: 'session.create',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1),
    provider: z.string().min(1),
    reasoningMode: reasoningModeSchema.optional(),
  }),
  output: z.object({
    sessionId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  }),
} as const;

// ---- Invoke: session.send ----
export const sessionSendChannel = {
  name: 'session.send',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    prompt: z.string().min(1).max(MAX_PROMPT_BYTES),
  }),
  output: z.object({
    // 只是 ACK"已排进 session 队列"——真正结果走 session.event push
    accepted: z.literal(true),
  }),
} as const;

// ---- Invoke: session.cancel ----
export const sessionCancelChannel = {
  name: 'session.cancel',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    cancelled: z.boolean(),
  }),
} as const;

// ---- Invoke: session.list ----
export const sessionListChannel = {
  name: 'session.list',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    sessions: z.array(sessionMetaSchema),
  }),
} as const;

// ---- Invoke: session.delete ----
export const sessionDeleteChannel = {
  name: 'session.delete',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    deleted: z.boolean(),
  }),
} as const;

// ---- Push: session.event ----
//
// Discriminated union by `kind`。每条都带 sessionId（同时跑多 session 时 renderer 路由用）。
// 字段命名贴近 @kodax-ai/coding 的 KodaXEvents，便于 Real adapter 一对一映射（详见 docs/features/v0.1.0.md FEATURE_003）。
const toolInputSchema = z.record(z.unknown());
const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadInputTokens: z.number().int().nonnegative().optional(),
    cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  })
  .optional();

export const sessionEventChannel = {
  name: 'session.event',
  direction: 'push',
  payload: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('text_delta'),
      sessionId: z.string().min(1),
      text: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      kind: z.literal('thinking_delta'),
      sessionId: z.string().min(1),
      text: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      kind: z.literal('tool_start'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1),
      input: toolInputSchema.optional(),
    }),
    z.object({
      kind: z.literal('tool_progress'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      message: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      kind: z.literal('tool_result'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1),
      content: z.string().max(MAX_TOOL_RESULT),
    }),
    z.object({
      kind: z.literal('iteration_end'),
      sessionId: z.string().min(1),
      iter: z.number().int().nonnegative(),
      maxIter: z.number().int().positive(),
      tokenCount: z.number().int().nonnegative(),
      usage: tokenUsageSchema,
    }),
    z.object({
      kind: z.literal('session_complete'),
      sessionId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('session_error'),
      sessionId: z.string().min(1),
      error: z.string(),
    }),
  ]),
} as const;

export type SessionMeta = z.infer<typeof sessionMetaSchema>;
export type SessionEvent = z.infer<typeof sessionEventChannel.payload>;
export type SessionEventKind = SessionEvent['kind'];

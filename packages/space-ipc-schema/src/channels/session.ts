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

// ---- Permission mode (FEATURE_007 / alpha.1) ----
//
// Claude Desktop 嵌 Claude Code 截图揭示的 4 种 mode：
//   - ask-permissions    每次工具调用都弹窗（alpha.0 默认）
//   - accept-edits       edit/write 自动批，dangerous (bash rm 等) 仍弹
//   - plan-mode          全部 deny — agent 只能输出 plan 不能动文件/命令
//   - bypass-permissions 全部 allow — 危险也跳过；UI 需 settings 显式 unlock 才能选
//
// main 端 PermissionBroker.request() 第一步根据 mode 做短路决策。
const permissionModeSchema = z.enum([
  'ask-permissions',
  'accept-edits',
  'plan-mode',
  'bypass-permissions',
]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

// ---- Provider ID (review F008 C2-sec)
//
// 限制 providerId 字符集到合法形态的并集——避免任意字符串混进 ManagedSession.provider 字段
// （`../../etc/passwd`、`%00injected`、`<script>` 等）。三类合法 ID：
//   - 'mock'                      — FEATURE_003 Mock adapter 入口
//   - kebab-case 字母数字          — built-in（'anthropic'、'zhipu-coding' 等）
//   - 'custom_' + 16 hex          — 用户自定义（F004 randomBytes(8).hex()）
//
// 与 ProviderConfigStore.addCustom 生成的 ID 格式严格对齐
const providerIdSchema = z.union([
  z.literal('mock'),
  z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, { message: 'providerId must be kebab-case' }),
  z.string().regex(/^custom_[a-f0-9]{16}$/),
]);

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
//
// title 是可选——session 刚创建时为空，第一次 send 后由 host 用 prompt 头 50 字填一个临时值；
// FEATURE_006/008 时再升级成用 cheap LLM 总结成 ≤ 8 字。
// 用户可通过 session.setTitle 手工覆盖。
const sessionMetaSchema = z.object({
  sessionId: z.string().min(1),
  projectRoot: z.string().min(1),
  provider: providerIdSchema,
  reasoningMode: reasoningModeSchema,
  /** alpha.1：permission gate 模式。缺省 'ask-permissions' (alpha.0 行为)。*/
  permissionMode: permissionModeSchema.default('ask-permissions'),
  title: z.string().max(256).optional(),
  createdAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
});


// ---- Invoke: session.create ----
export const sessionCreateChannel = {
  name: 'session.create',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1),
    provider: providerIdSchema,
    reasoningMode: reasoningModeSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
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
//
// 可选 projectRoot 过滤——左抽屉切换项目时拉本项目下的 session。
// 不传则返回所有 session。
export const sessionListChannel = {
  name: 'session.list',
  direction: 'invoke',
  input: z
    .object({
      projectRoot: z.string().min(1).max(4096).optional(),
    })
    .optional(),
  output: z.object({
    sessions: z.array(sessionMetaSchema),
  }),
} as const;

// ---- Invoke: session.setTitle ----
//
// 手工设置标题。F005 让用户右键 session 卡片"Rename"用。
export const sessionSetTitleChannel = {
  name: 'session.setTitle',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    title: z.string().min(1).max(256),
  }),
  output: z.object({
    ok: z.boolean(),
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

// ---- Invoke: session.setPermissionMode ---- (alpha.1)
//
// Claude Desktop Mode 切换 (Ctrl+M)。立即生效——下一次 tool call 走新 mode。
//
// 'bypass-permissions' 需要 UI 端先解锁 settings flag 才允许传——这层 UI gate；
// main 端不区分 mode 的"信任度"，全部接受。如未来需要服务端二次校验（防 renderer 篡改
// 直接传 bypass），加 settings.bypass_permissions_enabled flag 同步到 main 即可。
export const sessionSetPermissionModeChannel = {
  name: 'session.setPermissionMode',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    mode: permissionModeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setReasoningMode ---- (FEATURE_008)
//
// 切 reasoning mode **不重启** session——新设置应用于下一条 prompt。
// Mock 阶段只在 main 端 ManagedSession 上更新字段；Real adapter 会把它传到 KodaX runtime。
export const sessionSetReasoningModeChannel = {
  name: 'session.setReasoningMode',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    mode: reasoningModeSchema,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Invoke: session.setProvider ---- (FEATURE_008)
//
// 切 provider 同样不重启 session——下一条 prompt 走新 provider。Real adapter 接入后
// 会重新 import provider class 并 swap LLM client。
// providerId 必须是 built-in 或 custom_<hex> ('mock' 也允许——FEATURE_003 兼容)
//
// 注意：schema 只验格式；main 端 handler 必须再做"是否实际存在于 catalog/custom" 检查
// （review F008 C1-sec）。否则 attacker 可让 session 指向永不存在的 custom_ID，
// real adapter 接入后会静默 fallback 或抛错
export const sessionSetProviderChannel = {
  name: 'session.setProvider',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    providerId: providerIdSchema,
  }),
  output: z.object({
    ok: z.boolean(),
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

// alpha.1 KodaX 0.7.40 全 surface 接通 — todo / managed_task_status / compact_* / retry_after /
// repointel_trace / session_start / iteration_start / stream_end / thinking_end / tool_input_delta /
// provider_recovery — payload shape 对照 KodaX packages/coding/src/types.ts KodaXEvents 抽取（subset；
// 只挑 desktop UI 驱动得到的字段），具体见 apps/desktop/electron/kodax/kodax-sdk-types.d.ts。
const todoItemSchema = z.object({
  id: z.string().min(1).max(128),
  content: z.string().max(2048),
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().max(2048).optional(),
});

const repointelTraceSchema = z.object({
  kind: z.string().min(1).max(64),
  mode: z.enum(['auto', 'off', 'oss', 'premium-shared', 'premium-native']).optional(),
  engine: z.string().max(64).optional(),
  bridge: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  latencyMs: z.number().nonnegative().max(600_000).optional(),
  cacheHit: z.boolean().optional(),
});

const retryAfterSchema = z.object({
  provider: z.string().min(1).max(64),
  waitMs: z.number().int().nonnegative().max(3_600_000),
  reason: z.enum(['rate-limit', 'overloaded']),
  source: z.enum([
    'retry-after-seconds',
    'retry-after-date',
    'retry-after-ms',
    'exponential-backoff',
  ]),
  attempt: z.number().int().nonnegative().max(100),
  maxAttempts: z.number().int().positive().max(100),
});

const managedLiveEventSchema = z.object({
  key: z.string().min(1).max(128),
  kind: z.enum(['progress', 'completed', 'notification', 'warning']),
  presentation: z.enum(['status', 'assistant', 'thinking']).optional(),
  phase: z.string().max(64).optional(),
  workerId: z.string().max(128).optional(),
  workerTitle: z.string().max(256).optional(),
  summary: z.string().max(1024),
  detail: z.string().max(MAX_TEXT_CHUNK).optional(),
  persistToHistory: z.boolean().optional(),
});

const managedTaskStatusSchema = z.object({
  agentMode: z.enum(['ama', 'sa']),
  harnessProfile: z.string().max(64),
  activeWorkerId: z.string().max(128).optional(),
  activeWorkerTitle: z.string().max(256).optional(),
  childFanoutClass: z.string().max(64).optional(),
  childFanoutCount: z.number().int().nonnegative().max(100).optional(),
  currentRound: z.number().int().nonnegative().max(100).optional(),
  maxRounds: z.number().int().nonnegative().max(100).optional(),
  phase: z.string().max(64).optional(),
  note: z.string().max(1024).optional(),
  detailNote: z.string().max(MAX_TEXT_CHUNK).optional(),
  events: z.array(managedLiveEventSchema).max(50).optional(),
  upgradeCeiling: z.string().max(64).optional(),
  globalWorkBudget: z.number().int().nonnegative().max(1_000_000).optional(),
  budgetUsage: z.number().int().nonnegative().max(1_000_000).optional(),
  budgetApprovalRequired: z.boolean().optional(),
  idleWaiting: z.boolean().optional(),
  idleWaitingPendingCount: z.number().int().nonnegative().max(100).optional(),
});

export const sessionEventChannel = {
  name: 'session.event',
  direction: 'push',
  payload: z.discriminatedUnion('kind', [
    // ---- 流式输出（v0.1.0-alpha.0 已有）----
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
      kind: z.literal('thinking_end'),
      sessionId: z.string().min(1),
      // 全量 thinking trace 在大 reasoning session 可能不小，但比 tool_result 小一档。
      // 256KB = MAX_TEXT_CHUNK，与单条 text/thinking_delta 同级——KodaX 内部 thinking 是
      // 流式累积的，到 onThinkingEnd 时长度 ≈ 所有 thinking_delta 拼接。512KB 太大易 DoS。
      thinking: z.string().max(MAX_TEXT_CHUNK),
    }),
    z.object({
      kind: z.literal('tool_start'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1),
      input: toolInputSchema.optional(),
    }),
    z.object({
      kind: z.literal('tool_input_delta'),
      sessionId: z.string().min(1),
      toolId: z.string().min(1).optional(),
      toolName: z.string().min(1),
      partialJson: z.string().max(MAX_TEXT_CHUNK),
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
      kind: z.literal('stream_end'),
      sessionId: z.string().min(1),
    }),
    // ---- session/iteration lifecycle ----
    z.object({
      kind: z.literal('session_start'),
      sessionId: z.string().min(1),
      provider: z.string().min(1).max(64),
    }),
    z.object({
      kind: z.literal('iteration_start'),
      sessionId: z.string().min(1),
      iter: z.number().int().nonnegative(),
      maxIter: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal('iteration_end'),
      sessionId: z.string().min(1),
      iter: z.number().int().nonnegative(),
      maxIter: z.number().int().positive(),
      tokenCount: z.number().int().nonnegative(),
      tokenSource: z.enum(['api', 'estimate']).optional(),
      scope: z.enum(['parent', 'worker']).optional(),
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
    // ---- Context compaction（KodaX onCompact* 系列）----
    z.object({
      kind: z.literal('compact_start'),
      sessionId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('compact_stats'),
      sessionId: z.string().min(1),
      tokensBefore: z.number().int().nonnegative().max(10_000_000),
      tokensAfter: z.number().int().nonnegative().max(10_000_000),
    }),
    z.object({
      kind: z.literal('compact_end'),
      sessionId: z.string().min(1),
    }),
    // ---- Provider retry / recovery ----
    z.object({
      kind: z.literal('retry_after'),
      sessionId: z.string().min(1),
      payload: retryAfterSchema,
    }),
    z.object({
      kind: z.literal('provider_recovery'),
      sessionId: z.string().min(1),
      stage: z.string().max(64),
      errorClass: z.string().max(64),
      attempt: z.number().int().nonnegative().max(100),
      maxAttempts: z.number().int().positive().max(100),
      delayMs: z.number().int().nonnegative().max(3_600_000),
      recoveryAction: z.string().max(64),
      ladderStep: z.number().int().nonnegative().max(10),
      fallbackUsed: z.boolean(),
    }),
    // ---- Repointel (repo intelligence) trace ----
    z.object({
      kind: z.literal('repointel_trace'),
      sessionId: z.string().min(1),
      event: repointelTraceSchema,
    }),
    // ---- Plan / Todo (Scout-seeded todo list) ----
    z.object({
      kind: z.literal('todo_update'),
      sessionId: z.string().min(1),
      items: z.array(todoItemSchema).max(200),
    }),
    // ---- Managed Task / Subagent status (Tasks popout) ----
    z.object({
      kind: z.literal('managed_task_status'),
      sessionId: z.string().min(1),
      status: managedTaskStatusSchema,
    }),
    // ---- FEATURE_008 legacy work_budget / harness_profile ----
    //
    // alpha.0 已经 wire 到 TopBar 上的两个事件。alpha.1 重构后 main 端可以
    // 从 managed_task_status (budgetUsage/globalWorkBudget/harnessProfile) 派生，
    // 但 schema 保留两个独立事件 — renderer 现有代码继续工作，不破坏向后兼容。
    z.object({
      kind: z.literal('work_budget'),
      sessionId: z.string().min(1),
      used: z.number().int().nonnegative().max(1_000_000),
      cap: z.number().int().positive().max(1_000_000),
    }),
    z.object({
      kind: z.literal('harness_profile'),
      sessionId: z.string().min(1),
      profile: z.enum(['H0_DIRECT', 'H1_EXECUTE_EVAL', 'H2_PLAN_EXECUTE_EVAL']),
      round: z.number().int().positive().max(100).optional(),
    }),
  ]),
} as const;

export type SessionMeta = z.infer<typeof sessionMetaSchema>;
export type SessionEvent = z.infer<typeof sessionEventChannel.payload>;
export type SessionEventKind = SessionEvent['kind'];

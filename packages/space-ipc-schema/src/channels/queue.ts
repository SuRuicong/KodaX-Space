// KodaX message queue channels — v0.1.x
//
// 暴露 KodaX SDK 的 process-global MessageQueue (@kodax-ai/kodax/agent) — FEATURE_115 + FEATURE_159.
// 当前 SDK 内部 mid-turn drain / subagent task-notification / REPL 等场景会写这个队列;
// Space 之前看不到内部状态,这里加 query + 实时订阅暴露给 renderer 做 UI 可观察。
//
// 安全 / DoS:
//   - peek 返回的 content 字段在 SDK 内部本来就是 user-controlled string;schema 限 32KB 防止
//     单条恶意大消息把 IPC envelope 撑爆
//   - 整体 array cap 200 (KodaX 内部队列长度上限在普通使用下远低于这个)
//   - kind 是 SDK 定义的闭集 enum,不会有未知值

import { z } from 'zod';

// KodaX SDK 的 MessagePriority — 'user' / 'background'。 user 先 drain, background 后置。
const messagePrioritySchema = z.enum(['user', 'background']);

// KodaX SDK 的 MessageMode — 区分用途。
//   'prompt'              — 真用户 prompt (REPL ESC 注入 / 用户多发)
//   'task-notification'   — 子 agent 完成通知,等待父 agent 拉取
//   'system-reminder'     — 主流程 inject 给 LLM 看的 ephemeral 提醒
const messageModeSchema = z.enum(['prompt', 'task-notification', 'system-reminder']);

const queuedMessageSchema = z.object({
  /** 稳定 id `msg-<seq>` — 给 UI dedupe + 单条精确撤销用 */
  id: z.string().min(1).max(64),
  priority: messagePrioritySchema,
  /** undefined = main-thread (协调器);  string = subagent id */
  agentId: z.string().min(1).max(128).optional(),
  mode: messageModeSchema,
  /** 32KB 单条上限 (DoS guard);超出 SDK 那边几乎不可能,但 IPC envelope 要兜底 */
  content: z.string().max(32 * 1024),
  /** Date.now() wall-clock;只用于 trace/UI 显示,不参与排序 */
  enqueuedAt: z.number().int().nonnegative(),
});

// --- Invoke: kodax.queueGet ---
//
// 读快照 (peek 不消费)。filter 字段全可选;不传 → 返回所有 main-thread 消息 (agentId=undefined)。
// 用户面板"查看队列"时调一次;变化时由 push channel 主动通知,不必 poll。
export const kodaxQueueGetChannel = {
  name: 'kodax.queueGet',
  direction: 'invoke',
  input: z
    .object({
      /** undefined 匹配 main-thread (没有 agentId 的消息);具体 id 只匹配该 subagent */
      agentId: z.string().min(1).max(128).optional(),
      /** 'user' = 只看 user 优先级; 'background' = 全部 (含 user + background)。默认 'background' 看全 */
      maxPriority: messagePrioritySchema.optional(),
      mode: messageModeSchema.optional(),
      /** 最多返回多少条 (默认 200) */
      limit: z.number().int().positive().max(500).optional(),
    })
    .optional(),
  output: z.object({
    messages: z.array(queuedMessageSchema).max(500),
    /** 整个队列的总长度 (跨 priority / agent),用于 badge 数字。即便 filter 后 messages 很少,total 仍反映全局 */
    totalSize: z.number().int().nonnegative(),
  }),
} as const;

// --- Push: kodax.queueChanged ---
//
// SDK MessageQueue.subscribe → 每次 enqueue/dequeue/clear → 派发给 renderer。
// Renderer 可以选择走"完全订阅 + 自己维护快照",或"收到事件后调 queueGet 重读" — 两种都行。
// 这里 payload 直接带 SDK 的 QueueEvent 形态 + 简化 snapshot,免 renderer 重新调 IPC。
const queueEventKindSchema = z.enum(['enqueued', 'dequeued', 'cleared']);
export const kodaxQueueChangedChannel = {
  name: 'kodax.queueChanged',
  direction: 'push',
  payload: z.object({
    kind: queueEventKindSchema,
    /** 受影响的消息 (enqueued: 1 条; dequeued / cleared: N 条) */
    affected: z.array(queuedMessageSchema).max(500),
    /** 事件后的完整快照,renderer 可以一次性 replace 显示 */
    snapshot: z.array(queuedMessageSchema).max(500),
    totalSize: z.number().int().nonnegative(),
  }),
} as const;

export type QueuedMessageT = z.infer<typeof queuedMessageSchema>;
export type MessagePriorityT = z.infer<typeof messagePrioritySchema>;
export type MessageModeT = z.infer<typeof messageModeSchema>;
export type QueueEventKindT = z.infer<typeof queueEventKindSchema>;

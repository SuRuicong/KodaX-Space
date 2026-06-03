// KodaX message queue IPC — query + subscribe (v0.1.x)
//
// 暴露 KodaX SDK 的 process-global MessageQueue (@kodax-ai/kodax/agent, FEATURE_115/159)
// 给 renderer:
//   - kodax.queueGet     一次性 peek (UI 打开 Queue 面板时拉一次)
//   - kodax.queueChanged push channel; main 启动后订阅 SDK queue 的 mutation,实时推给 renderer
//
// SDK 是 ESM-only subpath,main 是 CJS — 必须 dynamic import (跟其他 SDK 接入处一致)。

import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import type { QueuedMessageT, MessagePriorityT, MessageModeT } from '@kodax-space/space-ipc-schema';

type AgentModule = typeof import('@kodax-ai/kodax/agent');
let agentModuleCache: AgentModule | null = null;
async function loadAgent(): Promise<AgentModule> {
  if (agentModuleCache === null) {
    agentModuleCache = await import('@kodax-ai/kodax/agent');
  }
  return agentModuleCache;
}

/**
 * Renderer 同时只能把"流式中又敲的 prompt"压上限数到这个值。
 * 超过就 throw —— 防 renderer bug 或暴力点 Send 把 main 进程 OOM
 * (review HIGH-2, B1)。
 *
 * 10 条是经验值：用户能合理在 in-flight 期间挂载的连续追问数量上限，
 * 超过就是机器或意外行为。SDK 端 mid-turn drain 一次最多消费 N 条
 * (priority='user' 全收)，10 条相当于"撑一次 drain"。
 */
const MAX_QUEUE_DEPTH = 10;

/**
 * v0.1.4 B1：把"流式中用户又敲了一个 prompt"推到 SDK queue。
 *
 * - priority='user': KodaX mid-turn drain 把 user 排在 background 前
 * - mode='prompt': 当成新一轮用户输入处理（vs task-notification / system-reminder）
 * - **agentId=sessionId** (review HIGH-1)：把消息绑死到这个 session 上，
 *   SDK drain 时只有对应 session 的 mid-turn loop 才会消费它。
 *   多 in-flight session 时不会出现"A 的 prompt 被 B 跑掉"。
 *   sessionId === RealKodaXSession.sessionId（host map 的 key）。
 *
 * 失败抛：
 *   - queue 已满（>= MAX_QUEUE_DEPTH）→ throw，registerChannel 转 HANDLER_ERROR
 *     envelope，BottomBar 走 setErr 路径 + rollbackLastUserMessage 收尾
 *
 * 返回 SDK 分配的消息 id；renderer 用它跟 user message 做 correlation
 * （目前还只做"标 queued"，未来如要做"dequeued → 清 pill"再用）。
 */
export async function enqueueUserPrompt(sessionId: string, content: string): Promise<string> {
  const agent = await loadAgent();
  const q = agent.getMessageQueue();
  if (q.size() >= MAX_QUEUE_DEPTH) {
    throw new Error(
      `Message queue full (${q.size()} >= ${MAX_QUEUE_DEPTH}); wait for the current turn to drain`,
    );
  }
  return q.enqueue({
    priority: 'user',
    mode: 'prompt',
    content,
    agentId: sessionId,
  });
}

/**
 * v0.1.4 B1 review MEDIUM-2/3：清空指定 session 的所有 queued 消息。
 * Stop 按钮 + session.dispose 都调这个，让"用户预期是停"真的是停，
 * 不被 queue 里残留的 prompt 立刻再拉起新 run / 跑到错的 session。
 *
 * 用 dequeue（带 filter）而不是 SDK 的全局 clear() —— 后者会扫掉别的
 * session 的 queue 项。dequeue 返回 dropped 数量供日志，main 端 caller
 * 不需要拿走具体内容。
 *
 * agentId 与 enqueueUserPrompt 对称（都是 RealKodaXSession.sessionId）。
 */
export async function drainQueueForSession(sessionId: string): Promise<number> {
  if (agentModuleCache === null) return 0; // queue 没初始化过 → 没东西可清
  const q = agentModuleCache.getMessageQueue();
  const drained = q.dequeue({
    agentId: sessionId,
    // 'background' 是 enum 里"最大值"，覆盖 user + background 两档
    maxPriority: 'background',
  });
  return drained.length;
}

/** SDK QueuedMessage → IPC schema 形态 (zod 已经在 schema 出口校验,这里只做 plain object 投影)。*/
function projectMessage(m: import('@kodax-ai/kodax/agent').QueuedMessage): QueuedMessageT {
  const proj: QueuedMessageT = {
    id: m.id,
    priority: m.priority as MessagePriorityT,
    mode: m.mode as MessageModeT,
    content: m.content,
    enqueuedAt: m.enqueuedAt,
  };
  // agentId 是 optional;只在有值时投影出去,避免 schema 多余 undefined 字段
  if (m.agentId !== undefined) {
    return { ...proj, agentId: m.agentId };
  }
  return proj;
}

export function registerQueueChannels(): void {
  // kodax.queueGet — peek 当前快照,可选 filter
  registerChannel('kodax.queueGet', async (input) => {
    const agent = await loadAgent();
    const q = agent.getMessageQueue();
    const filter: import('@kodax-ai/kodax/agent').DequeueFilter = {
      agentId: input?.agentId,
      // 默认 'background' = 看全部 (含 user 和 background); 'user' = 只看 user 优先级
      maxPriority: input?.maxPriority ?? 'background',
      mode: input?.mode,
      limit: input?.limit,
    };
    const peeked = q.peek(filter);
    return {
      messages: peeked.map(projectMessage),
      totalSize: q.size(),
    };
  });
}

/**
 * 启动期订阅 SDK queue 的 mutation,转 push channel 给 renderer。
 * lazy 触发: 先 await SDK import,然后 subscribe — failure 不阻塞启动。
 * 返回 unsubscribe; main shutdown 时调 (当前 Space 不显式 shutdown,进程退出即清,可忽略)。
 */
export async function startQueueWatch(): Promise<() => void> {
  const agent = await loadAgent();
  const q = agent.getMessageQueue();
  const unsubscribe = q.subscribe((event) => {
    // SDK QueueEvent → IPC payload
    let affected: QueuedMessageT[];
    if (event.kind === 'enqueued') {
      affected = [projectMessage(event.message)];
    } else {
      affected = event.messages.map(projectMessage);
    }
    const snapshot = q.getSnapshot().map(projectMessage);
    pushToRenderer('kodax.queueChanged', {
      kind: event.kind,
      affected,
      snapshot,
      totalSize: q.size(),
    });
  });
  return unsubscribe;
}

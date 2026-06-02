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
 * v0.1.4 B1：把"流式中用户又敲了一个 prompt"推到 SDK queue。
 *
 * - priority='user': KodaX mid-turn drain 把 user 排在 background 前
 * - mode='prompt': 当成新一轮用户输入处理（vs task-notification / system-reminder）
 * - agentId=undefined: 主线程 session 消费（不路由给具体 subagent）
 *
 * 返回 SDK 分配的消息 id；renderer 用它跟 user message 做 correlation
 * （目前还只做"标 queued"，未来如要做"dequeued → 清 pill"再用）。
 *
 * 失败抛 —— caller 决定怎么 envelope。生产里 SDK chunk 应当一直在 cache，
 * 第一次冷启动时 main 已经在多处 prewarm 过。
 */
export async function enqueueUserPrompt(content: string): Promise<string> {
  const agent = await loadAgent();
  const q = agent.getMessageQueue();
  return q.enqueue({
    priority: 'user',
    mode: 'prompt',
    content,
  });
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

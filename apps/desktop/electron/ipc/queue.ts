// KodaX message queue IPC: query + subscribe.
//
// Space still exposes the SDK process-global MessageQueue for renderer
// visibility, but user follow-up prompts are kept in a Space-owned per-session
// queue. The SDK main-thread queue (`agentId === undefined`) is process-global,
// so using it for desktop session follow-ups lets an already-running different
// Space session drain the wrong prompt. Per-session local queues preserve
// concurrent sessions while keeping queued prompts observable in the UI.
import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import type {
  QueuedMessageT,
  MessagePriorityT,
  MessageModeT,
  QueueEventKindT,
} from '@kodax-space/space-ipc-schema';

type AgentModule = typeof import('@kodax-ai/kodax/agent');
type MessageQueue = ReturnType<AgentModule['getMessageQueue']>;
type QueuedMessage = import('@kodax-ai/kodax/agent').QueuedMessage;

type QueueGetInput = {
  readonly agentId?: string;
  readonly maxPriority?: MessagePriorityT;
  readonly mode?: MessageModeT;
  readonly limit?: number;
};

let agentModuleCache: AgentModule | null = null;
async function loadAgent(): Promise<AgentModule> {
  if (agentModuleCache === null) {
    agentModuleCache = await import('@kodax-ai/kodax/agent');
  }
  return agentModuleCache;
}

async function loadQueue(): Promise<MessageQueue> {
  const agent = await loadAgent();
  return agent.getMessageQueue();
}

const MAX_QUEUE_DEPTH_PER_SESSION = 10;
const QUEUE_CONTENT_SCHEMA_MAX = 32 * 1024;
const TRUNCATED_SUFFIX = '\n[truncated]';
let nextSpaceQueueSeq = 1;

type SpaceQueuedPrompt = {
  readonly id: string;
  readonly priority: 'user';
  readonly mode: 'prompt';
  readonly agentId: string;
  readonly content: string;
  readonly enqueuedAt: number;
};

const spacePromptQueues = new Map<string, SpaceQueuedPrompt[]>();

function projectMessage(m: QueuedMessage): QueuedMessageT {
  const proj: QueuedMessageT = {
    id: m.id,
    priority: m.priority as MessagePriorityT,
    mode: m.mode as MessageModeT,
    content: m.content,
    enqueuedAt: m.enqueuedAt,
  };
  if (m.agentId !== undefined) {
    return { ...proj, agentId: m.agentId };
  }
  return proj;
}

function clampQueueContentForIpc(content: string): string {
  if (content.length <= QUEUE_CONTENT_SCHEMA_MAX) return content;
  return content.slice(0, QUEUE_CONTENT_SCHEMA_MAX - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}

function projectSpacePrompt(m: SpaceQueuedPrompt): QueuedMessageT {
  return {
    id: m.id,
    priority: m.priority,
    mode: m.mode,
    agentId: m.agentId,
    content: clampQueueContentForIpc(m.content),
    enqueuedAt: m.enqueuedAt,
  };
}

function getSdkSnapshotIfLoaded(): { messages: QueuedMessageT[]; totalSize: number } {
  if (agentModuleCache === null) return { messages: [], totalSize: 0 };
  const q = agentModuleCache.getMessageQueue();
  return {
    messages: q.getSnapshot().map(projectMessage),
    totalSize: q.size(),
  };
}

function getSpacePromptSnapshot(): QueuedMessageT[] {
  const messages: QueuedMessageT[] = [];
  for (const queue of spacePromptQueues.values()) {
    messages.push(...queue.map(projectSpacePrompt));
  }
  return messages;
}

function getSpacePromptTotalSize(): number {
  let total = 0;
  for (const queue of spacePromptQueues.values()) total += queue.length;
  return total;
}

function priorityWithinMax(priority: MessagePriorityT, maxPriority: MessagePriorityT): boolean {
  if (maxPriority === 'background') return true;
  return priority === 'user';
}

function filterProjectedMessages(
  messages: readonly QueuedMessageT[],
  filter: QueueGetInput | undefined,
): QueuedMessageT[] {
  const maxPriority = filter?.maxPriority ?? 'background';
  const filtered = messages.filter((message) => {
    if (filter?.agentId !== undefined && message.agentId !== filter.agentId) return false;
    if (!priorityWithinMax(message.priority, maxPriority)) return false;
    if (filter?.mode !== undefined && message.mode !== filter.mode) return false;
    return true;
  });
  return filter?.limit !== undefined ? filtered.slice(0, filter.limit) : filtered;
}

function combinedSnapshot(): { messages: QueuedMessageT[]; totalSize: number } {
  const sdk = getSdkSnapshotIfLoaded();
  const space = getSpacePromptSnapshot();
  return {
    messages: [...sdk.messages, ...space],
    totalSize: sdk.totalSize + space.length,
  };
}

function emitQueueChanged(kind: QueueEventKindT, affected: QueuedMessageT[]): void {
  const snapshot = combinedSnapshot();
  pushToRenderer('kodax.queueChanged', {
    kind,
    affected,
    snapshot: snapshot.messages,
    totalSize: snapshot.totalSize,
  });
}

/**
 * Queue a follow-up user prompt for a single Space session.
 *
 * This intentionally does not enqueue into the SDK main-thread MessageQueue:
 * that SDK route is process-global and cannot distinguish Space desktop
 * sessions. RealKodaXSession consumes this queue when its current turn settles.
 */
export async function enqueueUserPrompt(sessionId: string, content: string): Promise<string> {
  const queue = spacePromptQueues.get(sessionId) ?? [];
  if (queue.length >= MAX_QUEUE_DEPTH_PER_SESSION) {
    throw new Error(
      `Message queue full for session ${sessionId} (${queue.length} >= ${MAX_QUEUE_DEPTH_PER_SESSION}); ` +
        'wait for the current turn to drain',
    );
  }

  const message: SpaceQueuedPrompt = {
    id: `space-msg-${nextSpaceQueueSeq++}`,
    priority: 'user',
    mode: 'prompt',
    agentId: sessionId,
    content,
    enqueuedAt: Date.now(),
  };
  queue.push(message);
  spacePromptQueues.set(sessionId, queue);
  emitQueueChanged('enqueued', [projectSpacePrompt(message)]);
  return message.id;
}

/** Pop the next queued follow-up prompt for one Space session. */
export function dequeueNextUserPromptForSession(sessionId: string): string | undefined {
  const queue = spacePromptQueues.get(sessionId);
  if (queue === undefined || queue.length === 0) return undefined;

  const [message] = queue.splice(0, 1);
  if (queue.length === 0) {
    spacePromptQueues.delete(sessionId);
  }
  if (message !== undefined) {
    emitQueueChanged('dequeued', [projectSpacePrompt(message)]);
    return message.content;
  }
  return undefined;
}

/** Clear Space-owned queued user prompts when a session is cancelled/disposed. */
export async function drainQueueForSession(sessionId: string): Promise<number> {
  const drained = spacePromptQueues.get(sessionId);
  if (drained === undefined || drained.length === 0) return 0;
  spacePromptQueues.delete(sessionId);
  emitQueueChanged('dequeued', drained.map(projectSpacePrompt));
  return drained.length;
}

export function registerQueueChannels(): void {
  registerChannel('kodax.queueGet', async (input) => {
    const q = await loadQueue();
    const filter: import('@kodax-ai/kodax/agent').DequeueFilter = {
      agentId: input?.agentId,
      maxPriority: input?.maxPriority ?? 'background',
      mode: input?.mode,
      limit: input?.limit,
    };
    const sdkMessages = q.peek(filter).map(projectMessage);
    const spaceMessages = filterProjectedMessages(getSpacePromptSnapshot(), input);
    const limit = input?.limit;
    const messages = [...sdkMessages, ...spaceMessages];
    return {
      messages: limit !== undefined ? messages.slice(0, limit) : messages,
      totalSize: q.size() + getSpacePromptTotalSize(),
    };
  });
}

export async function startQueueWatch(): Promise<() => void> {
  const q = await loadQueue();
  const unsubscribe = q.subscribe((event) => {
    let affected: QueuedMessageT[];
    if (event.kind === 'enqueued') {
      affected = [projectMessage(event.message)];
    } else {
      affected = event.messages.map(projectMessage);
    }
    emitQueueChanged(event.kind, affected);
  });
  return unsubscribe;
}

export function _resetQueueStateForTests(): void {
  nextSpaceQueueSeq = 1;
  spacePromptQueues.clear();
  agentModuleCache = null;
}

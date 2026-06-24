import { AsyncLocalStorage } from 'node:async_hooks';

type AgentModule = typeof import('@kodax-ai/kodax/agent');
type MessageQueue = ReturnType<AgentModule['getMessageQueue']>;
type QueuedMessage = import('@kodax-ai/kodax/agent').QueuedMessage;
type DequeueFilter = Parameters<MessageQueue['dequeue']>[0];
type EnqueueInput = Parameters<MessageQueue['enqueue']>[0];

type QueueEvent = Parameters<Parameters<MessageQueue['subscribe']>[0]>[0];
type QueueEventListener = Parameters<MessageQueue['subscribe']>[0];

type PatchedQueue = MessageQueue & {
  enqueue(input: EnqueueInput): string;
  dequeue(filter: DequeueFilter): QueuedMessage[];
  peek(filter: DequeueFilter): QueuedMessage[];
  count(filter: DequeueFilter): number;
  has(filter: DequeueFilter): boolean;
  clear(): void;
};

type QueueOriginals = {
  readonly enqueue: MessageQueue['enqueue'];
  readonly dequeue: MessageQueue['dequeue'];
  readonly peek: MessageQueue['peek'];
  readonly count: MessageQueue['count'];
  readonly has: MessageQueue['has'];
  readonly clear: MessageQueue['clear'];
};

const queueSessionScope = new AsyncLocalStorage<string>();
const patchedQueues = new WeakSet<MessageQueue>();
const ownersByMessageId = new Map<string, string>();

export function runWithSessionQueueScope<T>(sessionId: string, fn: () => T): T {
  return queueSessionScope.run(sessionId, fn);
}

export function getCurrentSessionQueueScope(): string | undefined {
  return queueSessionScope.getStore();
}

export function installSessionQueueGuard(queue: MessageQueue): void {
  if (patchedQueues.has(queue)) return;
  patchedQueues.add(queue);

  const target = queue as PatchedQueue;
  const originals: QueueOriginals = {
    enqueue: target.enqueue.bind(queue),
    dequeue: target.dequeue.bind(queue),
    peek: target.peek.bind(queue),
    count: target.count.bind(queue),
    has: target.has.bind(queue),
    clear: target.clear.bind(queue),
  };

  target.enqueue = (input) => {
    const id = originals.enqueue(input);
    const owner = queueSessionScope.getStore();
    if (owner !== undefined && isMainThreadPromptInput(input)) {
      ownersByMessageId.set(id, owner);
    }
    return id;
  };

  target.dequeue = (filter) => {
    const messages = originals.dequeue(withOwnerPredicate(filter));
    for (const message of messages) {
      ownersByMessageId.delete(message.id);
    }
    return messages;
  };

  target.peek = (filter) => originals.peek(withOwnerPredicate(filter));
  target.count = (filter) => originals.count(withOwnerPredicate(filter));
  target.has = (filter) => originals.has(withOwnerPredicate(filter));
  target.clear = () => {
    originals.clear();
    ownersByMessageId.clear();
  };
}

export function enqueueOwnedPrompt(queue: MessageQueue, sessionId: string, content: string): string {
  installSessionQueueGuard(queue);
  const id = queue.enqueue({
    priority: 'user',
    mode: 'prompt',
    content,
  });
  ownersByMessageId.set(id, sessionId);
  return id;
}

export function countOwnedPromptsForSession(queue: MessageQueue, sessionId: string): number {
  installSessionQueueGuard(queue);
  return queue.count({
    agentId: undefined,
    maxPriority: 'user',
    mode: 'prompt',
    predicate: (message) => ownerFor(message) === sessionId,
  });
}

export function dequeueOwnedPromptsForSession(
  queue: MessageQueue,
  sessionId: string,
  limit?: number,
): QueuedMessage[] {
  installSessionQueueGuard(queue);
  return queue.dequeue({
    agentId: undefined,
    maxPriority: 'user',
    mode: 'prompt',
    ...(limit !== undefined ? { limit } : {}),
    predicate: (message) => ownerFor(message) === sessionId,
  });
}

export function peekOwnedPromptsForSession(queue: MessageQueue, sessionId: string): QueuedMessage[] {
  installSessionQueueGuard(queue);
  return queue.peek({
    agentId: undefined,
    maxPriority: 'user',
    mode: 'prompt',
    predicate: (message) => ownerFor(message) === sessionId,
  });
}

export function ownerSessionForQueuedPrompt(message: QueuedMessage): string | undefined {
  return ownerFor(message);
}

export function _resetSessionQueueGuardForTests(): void {
  ownersByMessageId.clear();
}

function withOwnerPredicate(filter: DequeueFilter): DequeueFilter {
  const owner = queueSessionScope.getStore();
  if (owner === undefined || !shouldRestrictFilter(filter)) {
    return filter;
  }

  const previousPredicate = filter.predicate;
  return {
    ...filter,
    predicate: (message) =>
      messageAllowedForSession(message, owner) &&
      (previousPredicate === undefined || previousPredicate(message)),
  };
}

function shouldRestrictFilter(filter: DequeueFilter): boolean {
  if (filter.agentId !== undefined) return false;
  return filter.mode === undefined || filter.mode === 'prompt';
}

function messageAllowedForSession(message: QueuedMessage, sessionId: string): boolean {
  if (!isMainThreadPromptMessage(message)) return true;
  const owner = ownerFor(message);
  return owner === undefined || owner === sessionId;
}

function ownerFor(message: QueuedMessage): string | undefined {
  return ownersByMessageId.get(message.id);
}

function isMainThreadPromptInput(input: EnqueueInput): boolean {
  return input.agentId === undefined && input.mode === 'prompt';
}

function isMainThreadPromptMessage(message: QueuedMessage): boolean {
  return message.agentId === undefined && message.mode === 'prompt';
}

export type { QueueEvent, QueueEventListener };

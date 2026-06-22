import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { getMessageQueue, _resetMessageQueueForTests } from '@kodax-ai/kodax/agent';
import { setRendererTarget } from '../ipc/push.js';
import type { WebContents } from 'electron';
import {
  _resetQueueStateForTests,
  dequeueNextUserPromptForSession,
  drainQueueForSession,
  enqueueUserPrompt,
} from '../ipc/queue.js';

beforeEach(() => {
  setRendererTarget(() => null);
  _resetMessageQueueForTests();
  _resetQueueStateForTests();
});

afterEach(() => {
  _resetMessageQueueForTests();
  _resetQueueStateForTests();
});

test('enqueueUserPrompt stores Space prompts per session without SDK main-thread queue', async () => {
  const queueId = await enqueueUserPrompt('s1', 'hello');
  const q = getMessageQueue();

  assert.match(queueId, /^space-msg-/);
  assert.equal(q.getSnapshot().length, 0);
  assert.equal(q.peek({ maxPriority: 'user', mode: 'prompt' }).length, 0);
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assert.equal(dequeueNextUserPromptForSession('s1'), 'hello');
  assert.equal(dequeueNextUserPromptForSession('s1'), undefined);
});

test('per-session prompt queues do not block other active sessions', async () => {
  await enqueueUserPrompt('s1', 'follow up from s1');
  await enqueueUserPrompt('s2', 'follow up from s2');

  assert.equal(dequeueNextUserPromptForSession('s2'), 'follow up from s2');
  assert.equal(dequeueNextUserPromptForSession('s1'), 'follow up from s1');
});

test('drainQueueForSession clears only that session', async () => {
  await enqueueUserPrompt('s1', 'one');
  await enqueueUserPrompt('s1', 'two');
  await enqueueUserPrompt('s2', 'other');

  assert.equal(await drainQueueForSession('s2'), 1);
  assert.equal(dequeueNextUserPromptForSession('s2'), undefined);
  assert.equal(dequeueNextUserPromptForSession('s1'), 'one');
  assert.equal(dequeueNextUserPromptForSession('s1'), 'two');
});

test('queue IPC preview clamps large prompts while preserving raw prompt', async () => {
  const sent: { current: { channel: string; payload: unknown } | null } = { current: null };
  const fakeWebContents = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      sent.current = { channel, payload };
    },
  } as unknown as WebContents;
  setRendererTarget(() => fakeWebContents);

  const longPrompt = 'x'.repeat(40_000);
  await enqueueUserPrompt('s1', longPrompt);

  assert.equal(sent.current?.channel, 'kodax.queueChanged');
  const payload = sent.current?.payload as { affected: Array<{ content: string }> };
  assert.equal(payload.affected[0]?.content.length, 32 * 1024);
  assert.ok(payload.affected[0]?.content.endsWith('\n[truncated]'));
  assert.equal(dequeueNextUserPromptForSession('s1'), longPrompt);
});

test('queue depth is enforced per session, not globally', async () => {
  for (let i = 0; i < 10; i += 1) {
    await enqueueUserPrompt('s1', `s1-${i}`);
  }

  await assert.rejects(
    () => enqueueUserPrompt('s1', 'too much'),
    /Message queue full for session s1/,
  );
  await assert.doesNotReject(() => enqueueUserPrompt('s2', 'still allowed'));
});

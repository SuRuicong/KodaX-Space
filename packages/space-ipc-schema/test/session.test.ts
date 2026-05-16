// Schema tests for session.* channels + session.event push payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  sessionCreateChannel,
  sessionSendChannel,
  sessionCancelChannel,
  sessionListChannel,
  sessionDeleteChannel,
  sessionEventChannel,
} from '../src/index.js';

test('all 5 session invoke channels are registered', () => {
  for (const name of ['session.create', 'session.send', 'session.cancel', 'session.list', 'session.delete']) {
    assert.ok(invokeChannels[name as keyof typeof invokeChannels], `${name} should be in invokeChannels`);
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in INVOKE_CHANNEL_NAMES`);
  }
});

test('session.event push channel is registered', () => {
  assert.ok(pushChannels['session.event']);
  assert.ok(PUSH_CHANNEL_NAMES.has('session.event'));
  assert.equal(sessionEventChannel.direction, 'push');
});

test('session.create input: requires projectRoot and provider', () => {
  assert.equal(sessionCreateChannel.input.safeParse({ projectRoot: '/r', provider: 'mock' }).success, true);
  assert.equal(sessionCreateChannel.input.safeParse({ provider: 'mock' }).success, false);
  assert.equal(sessionCreateChannel.input.safeParse({ projectRoot: '/r' }).success, false);
  assert.equal(sessionCreateChannel.input.safeParse({ projectRoot: '', provider: 'mock' }).success, false);
});

test('session.create input: rejects bogus reasoningMode', () => {
  const result = sessionCreateChannel.input.safeParse({
    projectRoot: '/r',
    provider: 'mock',
    reasoningMode: 'bogus',
  });
  assert.equal(result.success, false);
});

test('session.create output: requires sessionId + createdAt', () => {
  assert.equal(sessionCreateChannel.output.safeParse({ sessionId: 's_1', createdAt: 0 }).success, true);
  assert.equal(sessionCreateChannel.output.safeParse({ sessionId: 's_1' }).success, false);
  assert.equal(sessionCreateChannel.output.safeParse({ sessionId: 's_1', createdAt: -1 }).success, false);
});

test('session.send output is { accepted: true } literal', () => {
  assert.equal(sessionSendChannel.output.safeParse({ accepted: true }).success, true);
  // accepted: false 不被允许——失败走 envelope error，不走业务 ack
  assert.equal(sessionSendChannel.output.safeParse({ accepted: false }).success, false);
});

test('session.cancel and session.delete have ok-style booleans', () => {
  assert.equal(sessionCancelChannel.output.safeParse({ cancelled: true }).success, true);
  assert.equal(sessionCancelChannel.output.safeParse({ cancelled: false }).success, true);
  assert.equal(sessionDeleteChannel.output.safeParse({ deleted: true }).success, true);
});

test('session.list input is void; output requires sessions array', () => {
  assert.equal(sessionListChannel.input.safeParse(undefined).success, true);
  assert.equal(sessionListChannel.output.safeParse({ sessions: [] }).success, true);
});

test('session.event payload: text_delta variant', () => {
  const evt = { kind: 'text_delta' as const, sessionId: 's_1', text: 'hello' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: tool_start with input', () => {
  const evt = {
    kind: 'tool_start' as const,
    sessionId: 's_1',
    toolId: 't_1',
    toolName: 'read',
    input: { path: 'package.json' },
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: iteration_end with usage', () => {
  const evt = {
    kind: 'iteration_end' as const,
    sessionId: 's_1',
    iter: 1,
    maxIter: 30,
    tokenCount: 1280,
    usage: { inputTokens: 980, outputTokens: 300 },
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: rejects unknown kind (discriminated union locked)', () => {
  const evt = { kind: 'bogus', sessionId: 's_1' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: rejects mismatched fields for kind', () => {
  // tool_result 必须有 toolId / toolName / content；缺一个就失败
  const bad = { kind: 'tool_result' as const, sessionId: 's_1', toolId: 't', toolName: 'r' };
  assert.equal(sessionEventChannel.payload.safeParse(bad).success, false);
});

// ---- Size caps (review fix) ----

test('session.send rejects prompt over 1 MB (DoS guard)', () => {
  const tooBig = 'x'.repeat(1_048_577);
  const result = sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: tooBig });
  assert.equal(result.success, false);
  // 1 MB 整 exactly 边界仍接受
  const atLimit = 'x'.repeat(1_048_576);
  assert.equal(sessionSendChannel.input.safeParse({ sessionId: 's_1', prompt: atLimit }).success, true);
});

test('session.event text_delta rejects text over 256 KB', () => {
  const tooBig = 'x'.repeat(262_145);
  const evt = { kind: 'text_delta' as const, sessionId: 's_1', text: tooBig };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event tool_result rejects content over 512 KB', () => {
  const tooBig = 'x'.repeat(524_289);
  const evt = {
    kind: 'tool_result' as const,
    sessionId: 's_1',
    toolId: 't_1',
    toolName: 'read',
    content: tooBig,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

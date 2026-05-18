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

// --- FEATURE_008 new event variants ---

test('session.event payload: work_budget accepts valid', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: 42, cap: 200 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: work_budget rejects negative used', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: -1, cap: 200 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: work_budget rejects cap=0 (must be positive)', () => {
  const evt = { kind: 'work_budget' as const, sessionId: 's_1', used: 0, cap: 0 };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

test('session.event payload: harness_profile H0 without round', () => {
  const evt = { kind: 'harness_profile' as const, sessionId: 's_1', profile: 'H0_DIRECT' as const };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: harness_profile H2 with round', () => {
  const evt = {
    kind: 'harness_profile' as const,
    sessionId: 's_1',
    profile: 'H2_PLAN_EXECUTE_EVAL' as const,
    round: 3,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event payload: harness_profile rejects unknown profile', () => {
  const evt = { kind: 'harness_profile' as const, sessionId: 's_1', profile: 'H99_FAKE' };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

// --- review F008 C2-sec: providerId format guard ---

test('session.create input accepts mock / builtin / custom_<16hex>', () => {
  const valid = ['mock', 'anthropic', 'zhipu-coding', 'custom_0123456789abcdef'];
  for (const p of valid) {
    const r = sessionCreateChannel.input.safeParse({
      projectRoot: '/root',
      provider: p,
    });
    assert.equal(r.success, true, `should accept ${p}`);
  }
});

test('session.create input rejects malformed providerId', () => {
  const invalid = [
    '../../etc/passwd',
    '<script>alert(1)</script>',
    'custom_short',
    'custom_NOTHEX0000000000',
    'Anthropic', // uppercase
    'has space',
    '-leading-dash',
    'with_underscore',
  ];
  for (const p of invalid) {
    const r = sessionCreateChannel.input.safeParse({
      projectRoot: '/root',
      provider: p,
    });
    assert.equal(r.success, false, `should reject ${p}`);
  }
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

// ---- FEATURE_029: canonical 3 mode + auto engine ----

test('permissionMode enum accepts canonical 3: plan / accept-edits / auto', () => {
  for (const mode of ['plan', 'accept-edits', 'auto'] as const) {
    const result = sessionCreateChannel.input.safeParse({
      projectRoot: '/tmp/proj',
      provider: 'mock',
      permissionMode: mode,
    });
    assert.equal(result.success, true, `should accept ${mode}`);
  }
});

test('permissionMode enum rejects legacy values: ask-permissions / bypass-permissions / plan-mode', () => {
  for (const mode of ['ask-permissions', 'bypass-permissions', 'plan-mode']) {
    const result = sessionCreateChannel.input.safeParse({
      projectRoot: '/tmp/proj',
      provider: 'mock',
      permissionMode: mode,
    });
    assert.equal(result.success, false, `should reject legacy ${mode}`);
  }
});

test('session.event auto_engine_change variant accepted with reason enum', () => {
  for (const reason of ['manual', 'denial_threshold', 'circuit_breaker'] as const) {
    const evt = {
      kind: 'auto_engine_change' as const,
      sessionId: 's_1',
      engine: 'rules' as const,
      reason,
    };
    assert.equal(sessionEventChannel.payload.safeParse(evt).success, true, `reason=${reason}`);
  }
});

test('session.event auto_engine_change accepts engine without reason (optional)', () => {
  const evt = {
    kind: 'auto_engine_change' as const,
    sessionId: 's_1',
    engine: 'llm' as const,
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, true);
});

test('session.event auto_engine_change rejects invalid engine value', () => {
  const evt = {
    kind: 'auto_engine_change' as const,
    sessionId: 's_1',
    engine: 'something-else',
  };
  assert.equal(sessionEventChannel.payload.safeParse(evt).success, false);
});

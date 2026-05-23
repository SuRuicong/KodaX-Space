// composeMessages selector tests.
//
// 注：selector 文件本身在 renderer 端 (.tsx 旁) 但它是纯函数、零 React 依赖，
// 可以从 electron/test 直接 import 进 node:test 跑（tsx/esm 处理 .ts/.tsx 转译）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import {
  composeMessages,
  type ConversationMessage,
} from '../../renderer/src/features/session/composeMessages.js';
import type { UserMessage } from '../../renderer/src/store/appStore.js';

const sid = 's_1';

function userMsg(id: string, content: string, sentAt = 1000): UserMessage {
  return { id, content, sentAt };
}

function kindsOf(msgs: ConversationMessage[]): string[] {
  return msgs.map((m) => m.kind);
}

test('empty in → empty out', () => {
  assert.deepEqual(composeMessages({ events: [], userMessages: [] }), []);
});

test('only user message, no events: returns single user bubble', () => {
  const out = composeMessages({
    events: [],
    userMessages: [userMsg('u1', 'hello')],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'user');
  if (out[0].kind === 'user') assert.equal(out[0].content, 'hello');
});

test('user + consecutive text_deltas → user bubble + single merged assistant bubble', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Hello ' },
    { kind: 'text_delta', sessionId: sid, text: 'world' },
    { kind: 'text_delta', sessionId: sid, text: '!' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'hi')] });
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'system_notice']);
  const text = out[1];
  if (text.kind === 'assistant_text') assert.equal(text.text, 'Hello world!');
});

test('thinking_delta attaches to current assistant bubble', () => {
  const events: SessionEvent[] = [
    { kind: 'thinking_delta', sessionId: sid, text: 'pondering...' },
    { kind: 'text_delta', sessionId: sid, text: 'Answer: 42' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const bubble = out.find((m) => m.kind === 'assistant_text');
  assert.ok(bubble);
  if (bubble?.kind === 'assistant_text') {
    assert.equal(bubble.thinking, 'pondering...');
    assert.equal(bubble.text, 'Answer: 42');
  }
});

test('tool_start opens a card; tool_result fills it with status done', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'Let me check' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: { path: 'package.json' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: '{"name":"x"}',
    },
    { kind: 'text_delta', sessionId: sid, text: 'It says x.' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'what')] });
  // 期望：user → assistant("Let me check") → tool_call(read, done) → assistant("It says x.") → system_notice(complete)
  assert.deepEqual(kindsOf(out), ['user', 'assistant_text', 'tool_call', 'assistant_text', 'system_notice']);
  const tool = out[2];
  if (tool.kind === 'tool_call') {
    assert.equal(tool.toolName, 'read');
    assert.equal(tool.status, 'done');
    assert.equal(tool.result, '{"name":"x"}');
    assert.deepEqual(tool.input, { path: 'package.json' });
  }
});

test('tool_start without tool_result → status remains "running"', () => {
  const events: SessionEvent[] = [
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'sleep 99' },
    },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const tool = out.find((m) => m.kind === 'tool_call');
  if (tool?.kind === 'tool_call') {
    assert.equal(tool.status, 'running');
    assert.equal(tool.result, undefined);
  }
});

test('tool_progress updates an existing card progress field', () => {
  const events: SessionEvent[] = [
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'npm install' },
    },
    { kind: 'tool_progress', sessionId: sid, toolId: 't1', message: 'resolving 50 packages' },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const tool = out.find((m) => m.kind === 'tool_call');
  if (tool?.kind === 'tool_call') {
    assert.equal(tool.progress, 'resolving 50 packages');
    assert.equal(tool.status, 'running');
  }
});

test('iteration_end no longer pushes system_notice (data goes to BottomBar spinner/status)', () => {
  // 用户反馈：每轮中间的 "iter N/M · X tokens" 分隔线打断阅读节奏。改为只在状态栏 +
  // 流式 spinner 旁显示实时 iter / tokens；对话流里不再插这条 system_notice.
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'work' },
    {
      kind: 'iteration_end',
      sessionId: sid,
      iter: 2,
      maxIter: 30,
      tokenCount: 1500,
    },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const iterNotice = out.find((m) => m.kind === 'system_notice' && m.variant === 'iteration');
  assert.equal(iterNotice, undefined, 'iteration variant must not appear in conversation');
  // 但 ✓ complete 仍应出现 — 那是 session-level 标志
  const completeNotice = out.find((m) => m.kind === 'system_notice' && m.variant === 'complete');
  assert.ok(completeNotice, 'complete notice should still be emitted');
});

test('session_error emits system_notice variant=error with the error text', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'starting' },
    { kind: 'session_error', sessionId: sid, error: 'cancelled' },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const err = out[out.length - 1];
  assert.equal(err.kind, 'system_notice');
  if (err.kind === 'system_notice') {
    assert.equal(err.variant, 'error');
    assert.equal(err.text, 'cancelled');
  }
});

test('two user messages with separate event segments: events route to correct user turn', () => {
  // 用户问 1 -> assistant 答 1 + complete -> 用户问 2 -> assistant 答 2 + complete
  const events: SessionEvent[] = [
    // 第一轮
    { kind: 'text_delta', sessionId: sid, text: 'reply1' },
    { kind: 'session_complete', sessionId: sid },
    // 第二轮
    { kind: 'text_delta', sessionId: sid, text: 'reply2' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1000), userMsg('u2', 'q2', 2000)],
  });
  assert.deepEqual(kindsOf(out), [
    'user',
    'assistant_text',
    'system_notice',
    'user',
    'assistant_text',
    'system_notice',
  ]);
  // 内容对位
  if (out[1].kind === 'assistant_text') assert.equal(out[1].text, 'reply1');
  if (out[4].kind === 'assistant_text') assert.equal(out[4].text, 'reply2');
});

test('text_delta after tool_result starts a NEW assistant bubble (flushed by tool_start)', () => {
  // 验证 tool_start 切断了文本气泡，后续 text_delta 不会接续到前一个气泡
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'before' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: { path: 'a' },
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: 'A',
    },
    { kind: 'text_delta', sessionId: sid, text: 'after' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [userMsg('u1', 'q')] });
  const bubbles = out.filter((m) => m.kind === 'assistant_text');
  assert.equal(bubbles.length, 2);
  if (bubbles[0].kind === 'assistant_text' && bubbles[1].kind === 'assistant_text') {
    assert.equal(bubbles[0].text, 'before');
    assert.equal(bubbles[1].text, 'after');
  }
});

test('events arrived before any user message are still grouped at end', () => {
  // 启动期收到的事件（理论上不会，但兜底处理）
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'orphan' },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({ events, userMessages: [] });
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, 'assistant_text');
  assert.equal(out[1].kind, 'system_notice');
});

test('all messages have unique ids (no React key collisions)', () => {
  const events: SessionEvent[] = [
    { kind: 'text_delta', sessionId: sid, text: 'a' },
    {
      kind: 'tool_start',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      input: {},
    },
    {
      kind: 'tool_result',
      sessionId: sid,
      toolId: 't1',
      toolName: 'read',
      content: '',
    },
    { kind: 'text_delta', sessionId: sid, text: 'b' },
    { kind: 'iteration_end', sessionId: sid, iter: 1, maxIter: 30, tokenCount: 100 },
    { kind: 'session_complete', sessionId: sid },
  ];
  const out = composeMessages({
    events,
    userMessages: [userMsg('u1', 'q1', 1), userMsg('u2', 'q2', 2)],
  });
  const ids = out.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `duplicate ids: ${JSON.stringify(ids)}`);
});

// Pure-logic tests for tool aggregation in ConversationStreamV2.
//
// 不跑 React 渲染——只测 groupTools 折叠规则。验证：
//   1. 连续 tool_call 被折成一个 tool_group
//   2. tool_call 间被 text/user/system 打断时分成多个 group
//   3. 空输入 / 无 tool 输入 仍 valid

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMessage } from '../../renderer/src/features/session/composeMessages.js';

// 从 ConversationStreamV2 抽出来的 groupTools 副本（保持模块内部不导出，
// 测试在这里复制实现以便独立验证；如后续频繁改可考虑提取到 utils 共享）
type ToolGroup = {
  kind: 'tool_group';
  id: string;
  tools: Array<Extract<ConversationMessage, { kind: 'tool_call' }>>;
};
type ViewMessage = Exclude<ConversationMessage, { kind: 'tool_call' }> | ToolGroup;

function groupTools(messages: ConversationMessage[]): ViewMessage[] {
  const out: ViewMessage[] = [];
  let buffer: ToolGroup['tools'] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    out.push({ kind: 'tool_group', id: `group_${buffer[0].id}_${buffer.length}`, tools: buffer });
    buffer = [];
  };
  for (const m of messages) {
    if (m.kind === 'tool_call') buffer.push(m);
    else {
      flush();
      out.push(m);
    }
  }
  flush();
  return out;
}

function tool(id: string, toolName = 'read', status: 'running' | 'done' = 'done'): ConversationMessage {
  return { kind: 'tool_call', id, toolId: `t_${id}`, toolName, status };
}

function user(id: string, content = 'hi'): ConversationMessage {
  return { kind: 'user', id, content, sentAt: 0 };
}

function asst(id: string, text = 'reply'): ConversationMessage {
  return { kind: 'assistant_text', id, text };
}

test('groupTools: empty in → empty out', () => {
  assert.deepEqual(groupTools([]), []);
});

test('groupTools: no tools → unchanged', () => {
  const input: ConversationMessage[] = [user('u1'), asst('a1'), user('u2')];
  const out = groupTools(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].kind, 'user');
  assert.equal(out[1].kind, 'assistant_text');
  assert.equal(out[2].kind, 'user');
});

test('groupTools: single tool → group of 1', () => {
  const out = groupTools([tool('t1')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'tool_group');
  if (out[0].kind === 'tool_group') {
    assert.equal(out[0].tools.length, 1);
  }
});

test('groupTools: 3 consecutive tools → group of 3', () => {
  const out = groupTools([tool('t1'), tool('t2'), tool('t3')]);
  assert.equal(out.length, 1);
  if (out[0].kind === 'tool_group') {
    assert.equal(out[0].tools.length, 3);
  }
});

test('groupTools: tools broken by assistant text → two groups', () => {
  const out = groupTools([
    tool('t1'),
    tool('t2'),
    asst('a1'),
    tool('t3'),
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].kind, 'tool_group');
  assert.equal(out[1].kind, 'assistant_text');
  assert.equal(out[2].kind, 'tool_group');
  if (out[0].kind === 'tool_group') assert.equal(out[0].tools.length, 2);
  if (out[2].kind === 'tool_group') assert.equal(out[2].tools.length, 1);
});

test('groupTools: user + tools + system_notice pattern (typical Claude Code flow)', () => {
  const out = groupTools([
    user('u1', 'fix bug'),
    asst('a1', 'looking...'),
    tool('t1', 'read'),
    tool('t2', 'edit'),
    asst('a2', 'done'),
    { kind: 'system_notice', id: 'n1', variant: 'iteration', text: 'iter 1/30' },
  ]);
  assert.equal(out.length, 5);
  assert.equal(out[0].kind, 'user');
  assert.equal(out[1].kind, 'assistant_text');
  assert.equal(out[2].kind, 'tool_group');
  if (out[2].kind === 'tool_group') {
    assert.equal(out[2].tools.length, 2);
    assert.equal(out[2].tools[0].toolName, 'read');
    assert.equal(out[2].tools[1].toolName, 'edit');
  }
  assert.equal(out[3].kind, 'assistant_text');
  assert.equal(out[4].kind, 'system_notice');
});

test('groupTools: preserves tool order within group', () => {
  const out = groupTools([tool('t1', 'read'), tool('t2', 'edit'), tool('t3', 'bash')]);
  if (out[0].kind === 'tool_group') {
    assert.deepEqual(
      out[0].tools.map((t: { toolName: string }) => t.toolName),
      ['read', 'edit', 'bash'],
    );
  }
});

test('groupTools: group id deterministic from first tool id + count', () => {
  const out = groupTools([tool('t1'), tool('t2')]);
  if (out[0].kind === 'tool_group') {
    assert.equal(out[0].id, 'group_t1_2');
  }
});

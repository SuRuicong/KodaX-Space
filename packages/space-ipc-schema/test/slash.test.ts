// Slash IPC schema tests — F031 + F035.
//
// 主要锁 unknownCommand 字段（reviewer F035 HIGH-3）：renderer 通过此字段而非
// message 字符串 routing 到 skill.invoke。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slashExecChannel } from '../src/index.js';

test('slash.exec output accepts unknownCommand:true on miss', () => {
  const out = {
    ok: false,
    message: 'unknown command: /foo',
    unknownCommand: true,
  };
  assert.equal(slashExecChannel.output.safeParse(out).success, true);
});

test('slash.exec output accepts ok:true without unknownCommand', () => {
  const out = { ok: true, message: 'mode → plan' };
  assert.equal(slashExecChannel.output.safeParse(out).success, true);
});

test('slash.exec output rejects non-boolean unknownCommand', () => {
  const out = { ok: false, unknownCommand: 'yes' };
  assert.equal(slashExecChannel.output.safeParse(out).success, false);
});

test('slash.exec input accepts expected project and surface guard fields', () => {
  const result = slashExecChannel.input.safeParse({
    sessionId: 's_1',
    name: 'model',
    args: ['glm-5.2'],
    expectedProjectRoot: '/workspace/project-a',
    expectedSurface: 'code',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.expectedProjectRoot, '/workspace/project-a');
    assert.equal(result.data.expectedSurface, 'code');
  }

  assert.equal(
    slashExecChannel.input.safeParse({
      sessionId: 's_1',
      name: 'model',
      args: [],
      expectedSurface: 'docs',
    }).success,
    false,
  );
});
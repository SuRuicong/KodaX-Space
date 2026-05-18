// builtin slash command handlers — FEATURE_031.
//
// 覆盖：
//   /mode + 错误参数 + 未知 session
//   /auto-engine + 错误参数
//   /provider + 未知 providerId
//   /reasoning + 错误参数
//   /clear + 未知 session
//   /help 列出全部命令
//   未注册命令名 → unknown
//   handler throw → 错误信息回 renderer

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kodaxHost } from '../kodax/host.js';
import { setRendererTarget } from '../ipc/push.js';
import {
  _resetSlashRegistryForTesting,
  getSlashHandler,
  listSlashCommands,
  registerSlash,
} from '../slash/registry.js';
import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin.js';

let captured: Array<{ channel: string; payload: unknown }>;

beforeEach(async () => {
  captured = [];
  setRendererTarget(() => ({
    send: (channel: string, payload: unknown) => captured.push({ channel, payload }),
    isDestroyed: () => false,
  }) as unknown as Electron.WebContents);
  await kodaxHost.disposeAll();
  _resetSlashRegistryForTesting();
  for (const cmd of BUILTIN_SLASH_COMMANDS) {
    registerSlash(cmd);
  }
});

afterEach(async () => {
  setRendererTarget(() => null);
  await kodaxHost.disposeAll();
  _resetSlashRegistryForTesting();
});

async function runCmd(name: string, sessionId: string, args: string[] = []) {
  const handler = getSlashHandler(name);
  assert.ok(handler, `handler /${name} should be registered`);
  return handler!.handler({ sessionId, args });
}

test('listSlashCommands returns all 8 builtin in alpha order', () => {
  const cmds = listSlashCommands().map((c) => c.name);
  assert.deepEqual(
    cmds.slice().sort(),
    ['auto-engine', 'clear', 'help', 'mode', 'model', 'provider', 'reasoning', 'thinking'],
  );
});

test('/mode plan switches permission mode', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId, ['plan']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'plan');
});

test('/mode with no args returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('Usage:'));
});

test('/mode with unknown enum value returns valid-list message', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('mode', sessionId, ['turbo']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('plan'));
  assert.ok(result.message?.includes('accept-edits'));
  assert.ok(result.message?.includes('auto'));
});

test('/mode on unknown session returns false', async () => {
  const result = await runCmd('mode', 's_nope', ['plan']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
});

test('/auto-engine rules switches engine + emits auto_engine_change', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  captured = [];
  const result = await runCmd('auto-engine', sessionId, ['rules']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.autoModeEngine, 'rules');
  const ev = captured.find(
    (c) => c.channel === 'session.event'
      && (c.payload as { kind: string }).kind === 'auto_engine_change',
  );
  assert.ok(ev, 'auto-engine cmd should emit auto_engine_change');
});

test('/auto-engine with unknown value returns valid-list', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('auto-engine', sessionId, ['neural']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('llm'));
  assert.ok(result.message?.includes('rules'));
});

test('/reasoning quick switches reasoning mode', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('reasoning', sessionId, ['quick']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.reasoningMode, 'quick');
});

test('/provider with unknown id rejects (catalog gate)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('provider', sessionId, ['nonsense-provider']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('unknown'));
});

test('/provider mock accepted', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('provider', sessionId, ['mock']);
  assert.equal(result.ok, true);
});

test('/clear returns echo=true + clearStream=true for renderer-side reset', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('clear', sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.equal(result.clearStream, true);
});

test('non-clear builtins do NOT set clearStream', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const help = await runCmd('help', sessionId);
  assert.equal(help.clearStream, undefined, '/help should not request clearStream');
  const mode = await runCmd('mode', sessionId, ['plan']);
  assert.equal(mode.clearStream, undefined, '/mode should not request clearStream');
});

test('/clear on unknown session returns false', async () => {
  const result = await runCmd('clear', 's_nope');
  assert.equal(result.ok, false);
});

test('/help returns echo=true with command list', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('help', sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('/mode'));
  assert.ok(result.message?.includes('/auto-engine'));
});

test('/model returns not-supported message (placeholder)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('model', sessionId, ['some-model']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('not supported'));
});

test('/thinking returns not-supported message (placeholder)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['on']);
  assert.equal(result.ok, false);
});

test('/thinking with invalid arg returns Usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['maybe']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('Usage:'));
});

test('unknown command name → getSlashHandler returns undefined', () => {
  const handler = getSlashHandler('nonexistent');
  assert.equal(handler, undefined);
});

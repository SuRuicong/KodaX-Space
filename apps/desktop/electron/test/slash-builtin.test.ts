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
import { setUserConfigImpl, type KodaxUserConfigImpl } from '../kodax/user-config.js';
import { setRendererTarget } from '../ipc/push.js';
import {
  _resetSlashRegistryForTesting,
  getSlashHandler,
  listSlashCommands,
  registerSlash,
} from '../slash/registry.js';
import { BUILTIN_SLASH_COMMANDS, clearSlashGoalForSession } from '../slash/builtin.js';

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
  setUserConfigImpl(null);
  await kodaxHost.disposeAll();
  _resetSlashRegistryForTesting();
});

async function runCmd(name: string, sessionId: string, args: string[] = []) {
  const handler = getSlashHandler(name);
  assert.ok(handler, `handler /${name} should be registered`);
  return handler!.handler({ sessionId, args });
}

function mockUserConfig(config: Record<string, unknown>): void {
  const impl: KodaxUserConfigImpl = {
    loadConfig: (() => config) as never,
    registerCustomProviders: (() => undefined) as never,
  };
  setUserConfigImpl(impl);
}

test('listSlashCommands returns all builtin commands in alpha order', () => {
  const cmds = listSlashCommands().map((c) => c.name);
  // 持续随 KodaX SDK 暴露新命令而增长——做集合包含断言，而不锁死完整数量
  // 避免每次加新内置命令都得改这个测试
  const required = new Set([
    'agent-mode', 'auto', 'auto-denials', 'auto-engine', 'clear', 'compact', 'copy', 'cost',
    'delete', 'doctor', 'exit', 'extensions', 'fallback', 'fork', 'goal', 'help', 'history',
    'load', 'mcp', 'memory', 'mode', 'model', 'new', 'paste', 'provider', 'reasoning',
    'reload', 'repointel', 'review', 'rewind', 'save', 'sessions', 'skill', 'skills',
    'stall-log', 'status', 'thinking', 'verifier-log', 'workflow',
  ]);
  const sorted = cmds.slice().sort();
  for (const r of required) {
    assert.ok(sorted.includes(r), `builtin command /${r} should be registered`);
  }
  // 排序正确性仍校验
  assert.deepEqual(sorted, [...cmds].sort());
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
  assert.equal(result.ok, true);
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

test('/provider accepts custom provider from KodaX config.json', async () => {
  mockUserConfig({
    customProviders: [
      {
        name: 'newapi-anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://llm.example.com/v1',
        apiKeyEnv: 'NEWAPI_API_KEY',
        model: 'claude-sonnet-4-6',
      },
    ],
  });
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });

  const result = await runCmd('provider', sessionId, ['newapi-anthropic']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.provider, 'newapi-anthropic');
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

test('/help supports command topics and aliases', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('help', sessionId, ['model']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('/model'));
  assert.ok(result.message?.includes('/m'));
});

test('KodaX-compatible aliases resolve to canonical handlers', () => {
  const aliases: Array<[string, string]> = [
    ['m', 'model'],
    ['am', 'agent-mode'],
    ['a', 'auto'],
    ['reason', 'reasoning'],
    ['think', 'thinking'],
    ['t', 'thinking'],
    ['h', 'help'],
    ['?', 'help'],
    ['ri', 'repointel'],
    ['resume', 'load'],
    ['ls', 'sessions'],
    ['list', 'sessions'],
    ['rm', 'delete'],
    ['del', 'delete'],
    ['ext', 'extensions'],
    ['q', 'exit'],
    ['bye', 'exit'],
  ];
  for (const [alias, canonical] of aliases) {
    assert.equal(getSlashHandler(alias)?.name, canonical, `/${alias} should resolve to /${canonical}`);
  }
});

test('/model sets model override on session (v0.7.42 SDK wired)', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('model', sessionId, ['claude-opus-4-7']);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('claude-opus-4-7'));
  assert.equal(kodaxHost.get(sessionId)?.model, 'claude-opus-4-7');
});

test('/model default clears the override', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  await runCmd('model', sessionId, ['claude-opus-4-7']);
  const result = await runCmd('model', sessionId, ['default']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.model, undefined);
});

test('/model without arg returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('model', sessionId, []);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('Usage'));
});

test('/auto alias switches permission mode to auto', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('a', sessionId);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.permissionMode, 'auto');
});

test('/goal creates and reports an in-session goal', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const created = await runCmd('goal', sessionId, ['ship', 'workflow', '--tokens', '100']);
  assert.equal(created.ok, true);
  assert.ok(created.message?.includes('ship workflow'));
  assert.ok(created.message?.includes('100'));

  const status = await runCmd('goal', sessionId, ['status']);
  assert.equal(status.ok, true);
  assert.ok(status.message?.includes('ship workflow'));
});

test('clearSlashGoalForSession drops per-session goal state', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const created = await runCmd('goal', sessionId, ['ship', 'workflow']);
  assert.equal(created.ok, true);

  clearSlashGoalForSession(sessionId);
  const status = await runCmd('goal', sessionId, ['status']);
  assert.equal(status.ok, true);
  assert.ok(status.message?.includes('No goal set'));
});

test('/load, /delete, /mcp return renderer actions where appropriate', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  assert.equal((await runCmd('load', sessionId)).message, '__action__:list-sessions');
  assert.equal((await runCmd('load', sessionId, ['s_123'])).message, '__action__:load-session');
  assert.equal((await runCmd('delete', sessionId, ['s_123'])).message, '__action__:delete-session');
  assert.equal((await runCmd('mcp', sessionId, ['refresh'])).message, '__action__:show-mcp');
  assert.equal((await runCmd('mcp', sessionId, ['wat'])).ok, false);
});

test('/thinking on sets thinking=true on session', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['on']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.thinking, true);
});

test('/thinking off sets thinking=false on session', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('thinking', sessionId, ['off']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.thinking, false);
});

test('/agent-mode accepts amaw and alias', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('agent-mode', sessionId, ['amaw']);
  assert.equal(result.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'amaw');

  const alias = await runCmd('agent-mode', sessionId, ['ama-workflow']);
  assert.equal(alias.ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'amaw');
});

test('/agent-mode toggle cycles AMA -> AMAW -> SA', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'ama');
  assert.equal((await runCmd('agent-mode', sessionId, ['toggle'])).ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'amaw');
  assert.equal((await runCmd('agent-mode', sessionId, ['toggle'])).ok, true);
  assert.equal(kodaxHost.get(sessionId)?.agentMode, 'sa');
});

test('/workflow runs works before workflow manager init', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['runs']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('No workflow runs'));
});

test('/workflow help lists full workflow subcommands', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['help']);
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes('/workflow delete'));
  assert.ok(result.message?.includes('/workflow prune'));
  assert.ok(result.message?.includes('/workflow rerun'));
  assert.ok(result.message?.includes('/workflow revise'));
  assert.ok(result.message?.includes('/workflow create'));
});

test('/workflow prune --dry-run works before lifecycle init', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['prune', '--dry-run']);
  assert.equal(result.ok, true);
  assert.equal(result.echo, true);
  assert.ok(result.message?.includes('Workflow prune preview'));
});

test('/workflow create without request returns usage', async () => {
  const { sessionId } = kodaxHost.createSession({
    projectRoot: 'C:\\tmp\\proj',
    provider: 'mock',
  });
  const result = await runCmd('workflow', sessionId, ['create']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('Usage: /workflow create'));
});

test('/model on unknown session returns session_not_found', async () => {
  const result = await runCmd('model', 's_does_not_exist', ['some-model']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
});

test('/thinking on unknown session returns session_not_found', async () => {
  const result = await runCmd('thinking', 's_does_not_exist', ['on']);
  assert.equal(result.ok, false);
  assert.ok(result.message?.includes('session not found'));
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

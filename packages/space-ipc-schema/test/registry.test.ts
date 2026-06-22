// Schema package unit tests — run with `node --test --import tsx/esm`.
//
// 覆盖：
// - 有效入参通过 zod.parse
// - 无效入参被 zod 拒绝（schema invalid case）
// - 未注册 channel 在 getInvokeChannel 时返回 undefined
// - envelope ok/fail 工厂行为
// - INVOKE_CHANNEL_NAMES 与 invokeChannels 同源

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  getInvokeChannel,
  versionChannel,
  repointelStatusChannel,
  handoffListChannel,
  handoffAcceptChannel,
  handoffDismissChannel,
  handoffChangedChannel,
  ok,
  fail,
  type IpcResult,
} from '../src/index.js';

test('invokeChannels: space.version is registered', () => {
  assert.ok(invokeChannels['space.version'], 'space.version channel must be registered');
  assert.equal(versionChannel.name, 'space.version');
  assert.equal(versionChannel.direction, 'invoke');
});

test('invokeChannels: repointel.status is registered', () => {
  assert.ok(invokeChannels['repointel.status'], 'repointel.status channel must be registered');
  assert.equal(repointelStatusChannel.name, 'repointel.status');
  assert.equal(repointelStatusChannel.direction, 'invoke');
});

test('handoff channels are registered', () => {
  assert.ok(invokeChannels['handoff.list'], 'handoff.list channel must be registered');
  assert.ok(invokeChannels['handoff.accept'], 'handoff.accept channel must be registered');
  assert.ok(invokeChannels['handoff.dismiss'], 'handoff.dismiss channel must be registered');
  assert.ok(pushChannels['handoff.changed'], 'handoff.changed channel must be registered');
  assert.equal(handoffListChannel.direction, 'invoke');
  assert.equal(handoffAcceptChannel.direction, 'invoke');
  assert.equal(handoffDismissChannel.direction, 'invoke');
  assert.equal(handoffChangedChannel.direction, 'push');
});

test('INVOKE_CHANNEL_NAMES is derived from invokeChannels keys', () => {
  assert.equal(INVOKE_CHANNEL_NAMES.size, Object.keys(invokeChannels).length);
  for (const name of Object.keys(invokeChannels)) {
    assert.ok(INVOKE_CHANNEL_NAMES.has(name), `${name} should be in allowlist`);
  }
});

test('space.version input schema: undefined parses', () => {
  const result = versionChannel.input.safeParse(undefined);
  assert.equal(result.success, true);
});

test('space.version input schema: non-undefined fails (catches caller bugs)', () => {
  const result = versionChannel.input.safeParse({ accidentalPayload: true });
  assert.equal(result.success, false);
});

test('space.version output schema: valid object parses', () => {
  const valid = {
    spaceVersion: '0.1.0-alpha.0',
    nodeVersion: '20.18.3',
    electronVersion: '33.2.0',
    chromeVersion: '130.0.0.0',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.21',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
        since: '0.1.19',
      },
    ],
  };
  const result = versionChannel.output.safeParse(valid);
  assert.equal(result.success, true);
});

test('space.version output schema: rejects empty string fields', () => {
  const invalid = {
    spaceVersion: '',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.21',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('space.version output schema: rejects unknown platform', () => {
  const invalid = {
    spaceVersion: '0.1.0',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'plan9',
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.21',
    capabilities: [
      {
        id: 'repointel.trace',
        label: 'Repointel trace',
        status: 'supported' as const,
        detail: 'Session trace events are consumed by Space.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('space.version output schema: rejects unknown capability status', () => {
  const invalid = {
    spaceVersion: '0.1.0',
    nodeVersion: '20',
    electronVersion: '33',
    chromeVersion: '130',
    platform: 'win32' as const,
    kodaxSdkVersion: '0.7.52',
    kodaxDependencySpec: '^0.7.52',
    capabilityContract: 'space-v0.1.21',
    capabilities: [
      {
        id: 'quickAsk.sideQuery',
        label: 'Quick Ask side query',
        status: 'maybe',
        detail: 'SDK contract is not exposed.',
      },
    ],
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
});

test('repointel.status input and output schema', () => {
  assert.equal(repointelStatusChannel.input.safeParse({ projectRoot: 'C:/repo' }).success, true);
  assert.equal(repointelStatusChannel.input.safeParse({ projectRoot: '' }).success, false);

  const output = repointelStatusChannel.output.safeParse({
    projectRoot: 'C:/repo',
    projectExists: true,
    gitRoot: 'C:/repo',
    traceSource: 'session-events',
    warmSupported: false,
    warmReason: 'The current KodaX SDK does not expose a standalone warm API.',
    diagnostics: [
      {
        id: 'project',
        status: 'ok',
        detail: 'Project directory is readable.',
      },
    ],
  });
  assert.equal(output.success, true);
});

test('handoff list output accepts valid, stale, and invalid entries', () => {
  const result = handoffListChannel.output.safeParse({
    handoffs: [
      {
        id: 'abc',
        filePath: 'C:/Users/me/.kodax/handoffs/abc.json',
        status: 'valid',
        sessionId: 'sess_1',
        projectRoot: 'C:/repo',
        source: 'cli',
        createdAt: Date.now(),
      },
      {
        id: 'bad',
        filePath: 'C:/Users/me/.kodax/handoffs/bad.json',
        status: 'invalid',
        sessionId: null,
        projectRoot: null,
        source: null,
        createdAt: null,
        error: 'invalid JSON',
      },
    ],
  });
  assert.equal(result.success, true);
});

test('handoff accept input accepts optional expected session guard', () => {
  assert.equal(handoffAcceptChannel.input.safeParse({ handoffId: 'abc' }).success, true);
  assert.equal(
    handoffAcceptChannel.input.safeParse({ handoffId: 'abc', expectedSessionId: 'sess_1' }).success,
    true,
  );
  assert.equal(
    handoffAcceptChannel.input.safeParse({ handoffId: 'abc', expectedSessionId: '' }).success,
    false,
  );
});

test('getInvokeChannel: known channel returns definition', () => {
  const def = getInvokeChannel('space.version');
  assert.ok(def);
  assert.equal(def?.name, 'space.version');
});

test('getInvokeChannel: unknown channel returns undefined', () => {
  const def = getInvokeChannel('totally.bogus.channel');
  assert.equal(def, undefined);
});

test('envelope ok() produces { ok: true, data }', () => {
  const result: IpcResult<number> = ok(42);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data, 42);
  }
});

test('envelope fail() produces { ok: false, error: {code, message, details?} }', () => {
  const result = fail('SCHEMA_INVALID', 'bad input', { fieldErrors: { foo: ['required'] } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'SCHEMA_INVALID');
    assert.equal(result.error.message, 'bad input');
    assert.deepEqual(result.error.details, { fieldErrors: { foo: ['required'] } });
  }
});

test('envelope fail() works without details', () => {
  const result = fail('INTERNAL', 'oops');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.details, undefined);
  }
});

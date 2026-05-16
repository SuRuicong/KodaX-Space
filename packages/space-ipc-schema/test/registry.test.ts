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
  INVOKE_CHANNEL_NAMES,
  getInvokeChannel,
  versionChannel,
  ok,
  fail,
  type IpcResult,
} from '../src/index.js';

test('invokeChannels: space.version is registered', () => {
  assert.ok(invokeChannels['space.version'], 'space.version channel must be registered');
  assert.equal(versionChannel.name, 'space.version');
  assert.equal(versionChannel.direction, 'invoke');
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
  };
  const result = versionChannel.output.safeParse(invalid);
  assert.equal(result.success, false);
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

// updater.check / updater.install / updater.status schema tests — F022 / v0.1.3

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  updaterCheckChannel,
  updaterInstallChannel,
  updaterStatusChannel,
} from '../src/index.js';

test('updater channels registered in both maps + name sets', () => {
  assert.ok(invokeChannels['updater.check']);
  assert.ok(invokeChannels['updater.install']);
  assert.ok(pushChannels['updater.status']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('updater.check'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('updater.install'));
  assert.ok(PUSH_CHANNEL_NAMES.has('updater.status'));
});

test('updater.check input is strict empty object', () => {
  assert.equal(updaterCheckChannel.input.safeParse({}).success, true);
  // strict → 任何额外字段都拒
  assert.equal(updaterCheckChannel.input.safeParse({ force: true }).success, false);
});

test('updater.check output requires enabled + state', () => {
  assert.equal(
    updaterCheckChannel.output.safeParse({ enabled: false, state: { state: 'idle' } }).success,
    true,
  );
  assert.equal(
    updaterCheckChannel.output.safeParse({
      enabled: true,
      state: { state: 'available', version: '0.1.4' },
    }).success,
    true,
  );
  assert.equal(updaterCheckChannel.output.safeParse({ enabled: true }).success, false);
});

test('updater.install output requires accepted boolean', () => {
  assert.equal(updaterInstallChannel.output.safeParse({ accepted: true }).success, true);
  assert.equal(updaterInstallChannel.output.safeParse({ accepted: false }).success, true);
  assert.equal(updaterInstallChannel.output.safeParse({}).success, false);
});

test('updater.status discriminated union accepts every state variant', () => {
  assert.equal(updaterStatusChannel.payload.safeParse({ state: 'idle' }).success, true);
  assert.equal(updaterStatusChannel.payload.safeParse({ state: 'checking' }).success, true);
  assert.equal(
    updaterStatusChannel.payload.safeParse({ state: 'available', version: '0.1.4' }).success,
    true,
  );
  assert.equal(
    updaterStatusChannel.payload.safeParse({
      state: 'downloading',
      version: '0.1.4',
      percent: 42.5,
    }).success,
    true,
  );
  assert.equal(
    updaterStatusChannel.payload.safeParse({ state: 'ready', version: '0.1.4' }).success,
    true,
  );
  assert.equal(
    updaterStatusChannel.payload.safeParse({ state: 'error', message: 'boom' }).success,
    true,
  );
});

test('updater.status rejects out-of-range percent', () => {
  assert.equal(
    updaterStatusChannel.payload.safeParse({
      state: 'downloading',
      version: '0.1.4',
      percent: 120,
    }).success,
    false,
  );
  assert.equal(
    updaterStatusChannel.payload.safeParse({
      state: 'downloading',
      version: '0.1.4',
      percent: -1,
    }).success,
    false,
  );
});

test('updater.status rejects missing version on stateful variants', () => {
  assert.equal(updaterStatusChannel.payload.safeParse({ state: 'available' }).success, false);
  assert.equal(updaterStatusChannel.payload.safeParse({ state: 'ready' }).success, false);
});

test('updater.status error message clamped to 280 chars', () => {
  const big = 'x'.repeat(281);
  assert.equal(
    updaterStatusChannel.payload.safeParse({ state: 'error', message: big }).success,
    false,
  );
  assert.equal(
    updaterStatusChannel.payload.safeParse({ state: 'error', message: 'x'.repeat(280) }).success,
    true,
  );
});

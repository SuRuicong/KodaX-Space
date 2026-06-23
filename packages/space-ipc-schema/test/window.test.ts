import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pushChannels, PUSH_CHANNEL_NAMES, windowActivityChannel } from '../src/index.js';

test('window.activity push channel is registered', () => {
  assert.ok(pushChannels['window.activity']);
  assert.ok(PUSH_CHANNEL_NAMES.has('window.activity'));
  assert.equal(windowActivityChannel.name, 'window.activity');
  assert.equal(windowActivityChannel.direction, 'push');
});

test('window.activity payload accepts active, passive, and hidden states', () => {
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'active',
      active: true,
      focused: true,
      visible: true,
      minimized: false,
    }).success,
    true,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'passive',
      active: false,
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    true,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'hidden',
      active: false,
      focused: false,
      visible: false,
      minimized: true,
    }).success,
    true,
  );
});

test('window.activity payload rejects unknown state and non-boolean flags', () => {
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'background',
      active: false,
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    false,
  );
  assert.equal(
    windowActivityChannel.payload.safeParse({
      state: 'passive',
      active: 'no',
      focused: false,
      visible: true,
      minimized: false,
    }).success,
    false,
  );
});

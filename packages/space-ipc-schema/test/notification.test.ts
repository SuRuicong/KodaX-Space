// notification.show / notification.clicked schema tests — F020 / v0.1.3

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  notificationShowChannel,
  notificationClickedChannel,
} from '../src/index.js';

test('notification.show + notification.clicked channels are registered', () => {
  assert.ok(invokeChannels['notification.show']);
  assert.ok(pushChannels['notification.clicked']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('notification.show'));
  assert.ok(PUSH_CHANNEL_NAMES.has('notification.clicked'));
});

test('notification.show input requires title (1..280 chars)', () => {
  // happy path
  assert.equal(
    notificationShowChannel.input.safeParse({ title: 'Session done', body: '24s' }).success,
    true,
  );
  // empty title rejected
  assert.equal(notificationShowChannel.input.safeParse({ title: '', body: '' }).success, false);
  // missing title rejected
  assert.equal(notificationShowChannel.input.safeParse({ body: 'x' }).success, false);
});

test('notification.show input enforces 280-char cap on title + body', () => {
  const huge = 'x'.repeat(281);
  assert.equal(notificationShowChannel.input.safeParse({ title: huge, body: '' }).success, false);
  assert.equal(notificationShowChannel.input.safeParse({ title: 'ok', body: huge }).success, false);
  // 280 exact is OK
  assert.equal(
    notificationShowChannel.input.safeParse({ title: 'x'.repeat(280), body: '' }).success,
    true,
  );
});

test('notification.show input accepts optional sessionId + silent flag', () => {
  assert.equal(
    notificationShowChannel.input.safeParse({
      title: 'done',
      body: '',
      sessionId: 's_123',
      silent: true,
    }).success,
    true,
  );
});

test('notification.show output: shown is required boolean', () => {
  assert.equal(notificationShowChannel.output.safeParse({ shown: true }).success, true);
  assert.equal(notificationShowChannel.output.safeParse({ shown: false }).success, true);
  assert.equal(notificationShowChannel.output.safeParse({}).success, false);
  assert.equal(notificationShowChannel.output.safeParse({ shown: 'yes' }).success, false);
});

test('notification.clicked push payload: sessionId optional', () => {
  // no sessionId is OK (clicked notification without context)
  assert.equal(notificationClickedChannel.payload.safeParse({}).success, true);
  assert.equal(notificationClickedChannel.payload.safeParse({ sessionId: 's_1' }).success, true);
  // sessionId, if present, must be non-empty + <= 128
  assert.equal(notificationClickedChannel.payload.safeParse({ sessionId: '' }).success, false);
  assert.equal(
    notificationClickedChannel.payload.safeParse({ sessionId: 'x'.repeat(129) }).success,
    false,
  );
});

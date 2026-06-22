import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatElapsed,
  isFreshLivePromptStart,
  shouldNotifyForCompletion,
} from '../../renderer/src/features/notifications/sessionCompleteNotificationModel.js';

test('session completion notification waits for long tasks', () => {
  assert.equal(
    shouldNotifyForCompletion({
      startedAt: 1_000,
      now: 60_999,
      focus: { hidden: true, focused: false },
    }),
    false,
  );
  assert.equal(
    shouldNotifyForCompletion({
      startedAt: 1_000,
      now: 61_000,
      focus: { hidden: true, focused: false },
    }),
    true,
  );
});

test('session completion notification stays quiet while Space is active', () => {
  assert.equal(
    shouldNotifyForCompletion({
      startedAt: 0,
      now: 120_000,
      focus: { hidden: false, focused: true },
    }),
    false,
  );
  assert.equal(
    shouldNotifyForCompletion({
      startedAt: 0,
      now: 120_000,
      focus: { hidden: false, focused: false },
    }),
    true,
  );
});

test('formatElapsed keeps compact duration labels', () => {
  assert.equal(formatElapsed(26_000), '26s');
  assert.equal(formatElapsed(86_000), '1m 26s');
  assert.equal(formatElapsed(3_660_000), '1h 1m');
});

test('live prompt start freshness rejects restored history timestamps', () => {
  const now = 1_000_000;
  assert.equal(isFreshLivePromptStart(now - 2_000, now), true);
  assert.equal(isFreshLivePromptStart(now + 4_000, now), true);
  assert.equal(isFreshLivePromptStart(now + 6_000, now), false);
  assert.equal(isFreshLivePromptStart(now - 10 * 60_000, now), false);
});

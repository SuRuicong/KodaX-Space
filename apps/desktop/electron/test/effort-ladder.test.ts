import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleEffortLadder,
  sdkEffortToReasoningMode,
} from '../../renderer/src/shell/effortLadder.js';

// Real 0.7.58 user-visible effort ladders (none/minimal are not user-visible rungs).
const CODING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const GLM_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

test('providers that CANNOT disable thinking (kimi-code/minimax) hide "Off"', () => {
  const ladder = visibleEffortLadder(CODING_EFFORTS, /* canDisableThinking */ false);
  assert.ok(!ladder.includes('off'), '"Off" must be hidden when the provider hard-rejects none');
  assert.ok(ladder.includes('auto'), '"Auto" is always available');
  assert.ok(ladder.includes('deep'));
});

test('providers that CAN disable thinking keep "Off" (Anthropic — separate thinking flag)', () => {
  const ladder = visibleEffortLadder(CODING_EFFORTS, /* canDisableThinking */ true);
  assert.ok(ladder.includes('off'));
  assert.ok(ladder.includes('auto'));
});

test('a declared none/minimal rung (GLM) surfaces "Off" too', () => {
  const ladder = visibleEffortLadder(GLM_EFFORTS, true);
  assert.ok(ladder.includes('off'));
});

test('unknown/non-reasoning model falls back to the full ladder, minus Off when disabling is impossible', () => {
  assert.deepEqual(visibleEffortLadder(undefined), ['off', 'quick', 'balanced', 'auto', 'deep']);
  assert.deepEqual(visibleEffortLadder(undefined, false), ['quick', 'balanced', 'auto', 'deep']);
  assert.deepEqual(visibleEffortLadder([], true), ['off', 'quick', 'balanced', 'auto', 'deep']);
});

test('ladder preserves canonical order', () => {
  const ladder = visibleEffortLadder(GLM_EFFORTS, true);
  const order = ['off', 'quick', 'balanced', 'auto', 'deep'];
  const idx = ladder.map((m) => order.indexOf(m));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'ladder must stay in canonical order');
});

test('sdkEffortToReasoningMode maps rungs to Space buckets', () => {
  assert.equal(sdkEffortToReasoningMode('none'), 'off');
  assert.equal(sdkEffortToReasoningMode('minimal'), 'off');
  assert.equal(sdkEffortToReasoningMode('low'), 'quick');
  assert.equal(sdkEffortToReasoningMode('medium'), 'balanced');
  assert.equal(sdkEffortToReasoningMode('max'), 'deep');
  assert.equal(sdkEffortToReasoningMode('bogus'), null);
});

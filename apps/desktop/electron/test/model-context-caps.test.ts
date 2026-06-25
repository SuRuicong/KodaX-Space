import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTEXT_CAP,
  getModelContextCap,
} from '../../renderer/src/shell/modelContextCaps.js';

test('GLM fallback caps track KodaX 0.7.56 provider capabilities', () => {
  assert.equal(getModelContextCap('glm-5.2'), 1_000_000);
  assert.equal(getModelContextCap('glm-5'), 200_000);
  assert.equal(getModelContextCap('glm-5.1'), 200_000);
  assert.equal(getModelContextCap('glm-5-turbo'), 200_000);
  assert.equal(getModelContextCap('glm-4.7'), 200_000);
});

test('Kimi K2.7 Code fallback cap tracks KodaX 0.7.56 provider capabilities', () => {
  assert.equal(getModelContextCap('kimi-k2.7-code'), 256_000);
  // ordering boundary: bare kimi-k2.7 (no -code) must fall through to the 200k
  // fallback, NOT be caught by the specific k2.7-code rule.
  assert.equal(getModelContextCap('kimi-k2.7'), 200_000);
  assert.equal(getModelContextCap('kimi-k2.6'), 200_000);
});

test('unknown and empty models use conservative default cap', () => {
  assert.equal(getModelContextCap('unknown-model'), DEFAULT_CONTEXT_CAP);
  assert.equal(getModelContextCap(undefined), DEFAULT_CONTEXT_CAP);
});

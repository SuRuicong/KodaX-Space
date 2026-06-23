import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTEXT_CAP, getModelContextCap } from '../../renderer/src/shell/modelContextCaps.js';

test('GLM fallback caps track KodaX 0.7.54 provider capabilities', () => {
  assert.equal(getModelContextCap('glm-5.2'), 1_000_000);
  assert.equal(getModelContextCap('glm-5'), 200_000);
  assert.equal(getModelContextCap('glm-5.1'), 200_000);
  assert.equal(getModelContextCap('glm-5-turbo'), 200_000);
  assert.equal(getModelContextCap('glm-4.7'), 200_000);
});

test('unknown and empty models use conservative default cap', () => {
  assert.equal(getModelContextCap('unknown-model'), DEFAULT_CONTEXT_CAP);
  assert.equal(getModelContextCap(undefined), DEFAULT_CONTEXT_CAP);
});
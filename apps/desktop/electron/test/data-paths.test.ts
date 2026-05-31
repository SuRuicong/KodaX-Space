// data-paths tests — OC-12
//
// 验收：
//   1. 默认 (无 env) → ~/.kodax / ~/.kodax/space
//   2. KODAX_TEST_ONBOARDING=<id> → tmpdir/kodax-test-<id>
//   3. KODAX_TEST_ONBOARDING=1 → tmpdir/kodax-test-<uuid> (auto)
//   4. 同 process 多次调返同路径（缓存）

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  getKodaxDir,
  getSpaceDataDir,
  _resetDataPathsCacheForTesting,
} from '../kodax/data-paths.js';

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.KODAX_TEST_ONBOARDING;
  _resetDataPathsCacheForTesting();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.KODAX_TEST_ONBOARDING;
  else process.env.KODAX_TEST_ONBOARDING = originalEnv;
  _resetDataPathsCacheForTesting();
});

test('no env → ~/.kodax', () => {
  delete process.env.KODAX_TEST_ONBOARDING;
  assert.equal(getKodaxDir(), path.join(os.homedir(), '.kodax'));
  assert.equal(getSpaceDataDir(), path.join(os.homedir(), '.kodax', 'space'));
});

test('KODAX_TEST_ONBOARDING=fixture-1 → tmpdir/kodax-test-fixture-1', () => {
  process.env.KODAX_TEST_ONBOARDING = 'fixture-1';
  const expected = path.join(os.tmpdir(), 'kodax-test-fixture-1');
  assert.equal(getKodaxDir(), expected);
  assert.equal(getSpaceDataDir(), path.join(expected, 'space'));
});

test('KODAX_TEST_ONBOARDING=1 → auto uuid suffix (stable across calls)', () => {
  process.env.KODAX_TEST_ONBOARDING = '1';
  const first = getKodaxDir();
  assert.ok(first.startsWith(path.join(os.tmpdir(), 'kodax-test-')));
  // Same process: cached
  const second = getKodaxDir();
  assert.equal(first, second);
});

test('cache survives between getKodaxDir and getSpaceDataDir calls', () => {
  process.env.KODAX_TEST_ONBOARDING = '1';
  const dir1 = getKodaxDir();
  const dir2 = getSpaceDataDir();
  assert.equal(path.dirname(dir2), dir1, 'space dir should sit under same kodax dir');
});

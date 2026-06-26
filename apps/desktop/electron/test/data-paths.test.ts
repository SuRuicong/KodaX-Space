// data-paths tests — OC-12
//
// 验收：
//   1. 默认 (无 env) → ~/.kodax / ~/.kodax/space
//   2. KODAX_TEST_ONBOARDING=<id> → tmpdir/kodax-test-<id>
//   3. KODAX_TEST_ONBOARDING=1 → tmpdir/kodax-test-<uuid> (auto)
//   4. PORTABLE_EXECUTABLE_DIR → portable-dir/.kodax
//   5. 同 process 多次调返同路径（缓存）

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  getKodaxDir,
  getPortableOrTestUserDataDir,
  getSpaceDataDir,
  _resetDataPathsCacheForTesting,
} from '../kodax/data-paths.js';

let originalEnv: string | undefined;
let originalPortableExecutableDir: string | undefined;
let originalPortableDataDir: string | undefined;

beforeEach(() => {
  originalEnv = process.env.KODAX_TEST_ONBOARDING;
  originalPortableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  originalPortableDataDir = process.env.KODAX_PORTABLE_DATA_DIR;
  _resetDataPathsCacheForTesting();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.KODAX_TEST_ONBOARDING;
  else process.env.KODAX_TEST_ONBOARDING = originalEnv;
  if (originalPortableExecutableDir === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
  else process.env.PORTABLE_EXECUTABLE_DIR = originalPortableExecutableDir;
  if (originalPortableDataDir === undefined) delete process.env.KODAX_PORTABLE_DATA_DIR;
  else process.env.KODAX_PORTABLE_DATA_DIR = originalPortableDataDir;
  _resetDataPathsCacheForTesting();
});

test('no env → ~/.kodax', () => {
  delete process.env.KODAX_TEST_ONBOARDING;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  delete process.env.KODAX_PORTABLE_DATA_DIR;
  assert.equal(getKodaxDir(), path.join(os.homedir(), '.kodax'));
  assert.equal(getSpaceDataDir(), path.join(os.homedir(), '.kodax', 'space'));
  assert.equal(getPortableOrTestUserDataDir(), null);
});

test('KODAX_TEST_ONBOARDING=fixture-1 → tmpdir/kodax-test-fixture-1', () => {
  process.env.KODAX_TEST_ONBOARDING = 'fixture-1';
  const expected = path.join(os.tmpdir(), 'kodax-test-fixture-1');
  assert.equal(getKodaxDir(), expected);
  assert.equal(getSpaceDataDir(), path.join(expected, 'space'));
  assert.equal(getPortableOrTestUserDataDir(), path.join(expected, 'space', 'electron-user-data'));
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

test('PORTABLE_EXECUTABLE_DIR → data follows the portable executable directory', () => {
  delete process.env.KODAX_TEST_ONBOARDING;
  const portableDir = path.join(os.tmpdir(), 'kodax-portable-fixture');
  process.env.PORTABLE_EXECUTABLE_DIR = portableDir;

  const expected = path.join(portableDir, '.kodax');
  assert.equal(getKodaxDir(), expected);
  assert.equal(getSpaceDataDir(), path.join(expected, 'space'));
  assert.equal(getPortableOrTestUserDataDir(), path.join(expected, 'space', 'electron-user-data'));
});

test('KODAX_PORTABLE_DATA_DIR overrides PORTABLE_EXECUTABLE_DIR', () => {
  delete process.env.KODAX_TEST_ONBOARDING;
  const portableDir = path.join(os.tmpdir(), 'kodax-portable-fixture');
  const explicitDir = path.join(os.tmpdir(), 'kodax-explicit-portable-fixture');
  process.env.PORTABLE_EXECUTABLE_DIR = portableDir;
  process.env.KODAX_PORTABLE_DATA_DIR = explicitDir;

  assert.equal(getKodaxDir(), path.join(explicitDir, '.kodax'));
});

test('KODAX_TEST_ONBOARDING rejects path traversal suffixes', () => {
  process.env.KODAX_TEST_ONBOARDING = '../../escape';
  assert.throws(() => getKodaxDir(), /safe \[A-Za-z0-9_-\] suffix/);
});

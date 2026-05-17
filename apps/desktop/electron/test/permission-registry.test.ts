// PermissionRegistry tests — FEATURE_007
//
// 用临时目录验证持久化、缓存、去重、撤销、损坏恢复、并发安全。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PermissionRegistry } from '../permission/registry.js';

let tmpDir = '';
let registryFile = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-perm-test-'));
  registryFile = path.join(tmpDir, 'permissions.json');
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test('load: empty when file does not exist', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  assert.deepEqual(reg.list(), []);
});

test('add then matches: read pattern matches read call', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await reg.add('read');
  assert.equal(reg.matches('read', { path: 'a' }), true);
  assert.equal(reg.matches('write', { path: 'a' }), false);
});

test('add: deduplicates by pattern (updates createdAt)', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await reg.add('read');
  const ts1 = reg.list()[0]?.createdAt ?? 0;
  await new Promise((r) => setTimeout(r, 5));
  await reg.add('read');
  assert.equal(reg.list().length, 1);
  const ts2 = reg.list()[0]?.createdAt ?? 0;
  assert.ok(ts2 >= ts1);
});

test('remove: returns true on existing, false on missing', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await reg.add('read');
  assert.equal(await reg.remove('read'), true);
  assert.equal(reg.list().length, 0);
  assert.equal(await reg.remove('read'), false);
});

test('persistence: add survives reload', async () => {
  const reg1 = new PermissionRegistry(registryFile, tmpDir);
  await reg1.load();
  await reg1.add('read');
  await reg1.add('bash:npm');

  const reg2 = new PermissionRegistry(registryFile, tmpDir);
  await reg2.load();
  const patterns = reg2.list().map((r) => r.pattern).sort();
  assert.deepEqual(patterns, ['bash:npm', 'read']);
});

test('matches: bash:npm covers npm subcommands but not git', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await reg.add('bash:npm');
  assert.equal(reg.matches('bash', { command: 'npm install' }), true);
  assert.equal(reg.matches('bash', { command: 'npm test --watch' }), true);
  assert.equal(reg.matches('bash', { command: 'git status' }), false);
});

test('matches: returns false before load() (defensive)', () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  // 故意不 load
  assert.equal(reg.matches('read', { path: 'a' }), false);
});

test('schema corruption: invalid JSON → empty start, no throw', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(registryFile, '{this is not valid json', 'utf-8');
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  assert.deepEqual(reg.list(), []);
  // 之后仍可正常 add
  await reg.add('read');
  assert.equal(reg.list().length, 1);
});

test('schema corruption: valid JSON but wrong shape → empty start', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify({ version: 99, rules: 'not an array' }), 'utf-8');
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  assert.deepEqual(reg.list(), []);
});

test('concurrent add: no lost update (writeLock serialises)', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await Promise.all([reg.add('a'), reg.add('b'), reg.add('c'), reg.add('d')]);
  const patterns = reg.list().map((r) => r.pattern).sort();
  assert.deepEqual(patterns, ['a', 'b', 'c', 'd']);

  // 验证文件也持久化了全部 4 条（而非最后一个胜出）
  const reg2 = new PermissionRegistry(registryFile, tmpDir);
  await reg2.load();
  assert.equal(reg2.list().length, 4);
});

test('atomic write: file does not appear half-written between mutations', async () => {
  const reg = new PermissionRegistry(registryFile, tmpDir);
  await reg.load();
  await reg.add('read');

  // 文件存在 → 文件名应为最终 permissions.json，而非 tmp 文件
  const entries = await fs.readdir(tmpDir);
  assert.ok(entries.includes('permissions.json'));
  // 任何 .tmp 残留都视为 bug
  const stray = entries.filter((e) => e.endsWith('.tmp'));
  assert.deepEqual(stray, []);

  // 内容能被解析回完整 JSON
  const raw = await fs.readFile(registryFile, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.rules.length, 1);
});

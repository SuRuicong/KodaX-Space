// v0.1.10 chore: ~/.kodax_space 孤儿目录清理 单测。
//
// 5 个场景: 不存在 / Electron userData 风 → 删 / KodaX SDK 数据风 → 保留 /
// 不认识 → 保留 / 单一 userData marker 不够 → 保留 (防误伤)。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupOrphanKodaxSpaceDir,
  type CleanupResult,
} from '../kodax/cleanup-orphan-kodax-space.js';

let testHome: string;
let orphan: string;

beforeEach(async () => {
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-cleanup-test-'));
  orphan = path.join(testHome, '.kodax_space');
});

afterEach(async () => {
  await fs.rm(testHome, { recursive: true, force: true }).catch(() => {});
});

async function seedOrphan(entries: Record<string, string | null>): Promise<void> {
  await fs.mkdir(orphan, { recursive: true });
  for (const [name, content] of Object.entries(entries)) {
    if (content === null) {
      // null = 作为子目录
      await fs.mkdir(path.join(orphan, name), { recursive: true });
    } else {
      await fs.writeFile(path.join(orphan, name), content);
    }
  }
}

test('not-found when ~/.kodax_space does not exist', async () => {
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'not-found');
});

test('removed-userdata when Electron userData markers present (>= 2)', async () => {
  await seedOrphan({
    Cache: null,
    'Local Storage': null,
    Preferences: '{}',
    'GPUCache': null,
  });
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'removed-userdata');
  if (r.kind === 'removed-userdata') {
    assert.equal(r.entries, 4);
  }
  // 目录被删了
  const exists = await fs
    .stat(orphan)
    .then(() => true)
    .catch(() => false);
  assert.equal(exists, false, 'orphan dir should be gone');
});

test('kept-kodax-data when KodaX SDK markers present (sessions/config.json)', async () => {
  await seedOrphan({
    sessions: null,
    'config.json': '{}',
    agents: null,
  });
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'kept-kodax-data');
  if (r.kind === 'kept-kodax-data') {
    assert.ok(r.matched.length >= 1);
    assert.ok(r.matched.includes('sessions') || r.matched.includes('config.json'));
  }
  // 目录被保留
  const exists = await fs
    .stat(orphan)
    .then(() => true)
    .catch(() => false);
  assert.equal(exists, true, 'orphan dir should be preserved');
});

test('kept-kodax-data takes priority over userData markers when both present (safe default)', async () => {
  // 防御: 万一同时有 sessions/ + Cache/, 仍保留 (语义 ambiguous,保守不删)
  await seedOrphan({
    Cache: null,
    'Local Storage': null,
    sessions: null,
    'config.json': '{}',
  });
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'kept-kodax-data');
});

test('kept-unknown when content unrecognized', async () => {
  await seedOrphan({
    'README.md': 'random',
    'data.bin': 'x',
  });
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'kept-unknown');
  if (r.kind === 'kept-unknown') {
    assert.equal(r.entries, 2);
    assert.ok(r.sample.length <= 5);
  }
});

test('kept-unknown when only 1 userData marker (high false-positive risk)', async () => {
  // 单个 Cache 目录可能是 KodaX agent cache 等,不删
  await seedOrphan({
    Cache: null,
    'random-file.txt': 'x',
  });
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'kept-unknown');
});

test('not-found when orphan path exists but is a file, not directory', async () => {
  await fs.writeFile(orphan, 'random');
  const r = await cleanupOrphanKodaxSpaceDir(testHome);
  assert.equal(r.kind, 'not-found');
  // 文件保留 (我们的策略只动 directory)
  const exists = await fs
    .stat(orphan)
    .then(() => true)
    .catch(() => false);
  assert.equal(exists, true);
});

test('error result never throws when readdir fails (best-effort guarantee)', async () => {
  // 用一个肯定 stat 失败的 path
  const r: CleanupResult = await cleanupOrphanKodaxSpaceDir('/non-existent-path-12345');
  // not-found 或 error 都是允许的 — 关键是不 throw
  assert.ok(r.kind === 'not-found' || r.kind === 'error');
});

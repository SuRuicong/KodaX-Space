import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionLocalNoticeStore } from '../kodax/session-local-notice-store.js';

let tmpDir = '';
let noticesDir = '';
let store: SessionLocalNoticeStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-session-local-notices-'));
  noticesDir = path.join(tmpDir, 'notices');
  store = new SessionLocalNoticeStore(noticesDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('SessionLocalNoticeStore appends and restores local slash notices', async () => {
  await store.append('s_local-1', {
    id: 'ln_1',
    content: '/repointel status',
    sentAt: 1000,
    variant: 'echo',
  });
  await store.append('s_local-1', {
    id: 'ln_2',
    content: '[repointel] status: ok',
    sentAt: 1001,
    variant: 'output',
  });

  assert.deepEqual(await store.list('s_local-1'), [
    { id: 'ln_1', content: '/repointel status', sentAt: 1000, variant: 'echo' },
    { id: 'ln_2', content: '[repointel] status: ok', sentAt: 1001, variant: 'output' },
  ]);
});

test('SessionLocalNoticeStore replace trims stale notices and empty replace clears the file', async () => {
  await store.append('s_local-2', { id: 'old', content: '/old', sentAt: 1000, variant: 'echo' });
  await store.replace('s_local-2', [
    { id: 'new', content: '/new', sentAt: 2000, variant: 'echo' },
  ]);

  assert.deepEqual(await store.list('s_local-2'), [
    { id: 'new', content: '/new', sentAt: 2000, variant: 'echo' },
  ]);

  await store.replace('s_local-2', []);
  assert.deepEqual(await store.list('s_local-2'), []);
});

test('SessionLocalNoticeStore hashes odd session ids instead of using them as paths', async () => {
  await store.append('../escape:sid', {
    id: 'ln_escape',
    content: '/status',
    sentAt: 1234,
    variant: 'echo',
  });

  const files = await fs.readdir(noticesDir);
  assert.equal(files.length, 1);
  assert.match(files[0] ?? '', /^[a-f0-9]{64}\.json$/);
  assert.deepEqual(await store.list('../escape:sid'), [
    { id: 'ln_escape', content: '/status', sentAt: 1234, variant: 'echo' },
  ]);
});

test('SessionLocalNoticeStore serializes concurrent appends', async () => {
  await Promise.all([
    store.append('s_local-concurrent', { id: 'a', content: '/a', sentAt: 1000, variant: 'echo' }),
    store.append('s_local-concurrent', { id: 'b', content: '/b', sentAt: 1001, variant: 'echo' }),
    store.append('s_local-concurrent', { id: 'c', content: '/c', sentAt: 1002, variant: 'echo' }),
  ]);

  assert.deepEqual(
    (await store.list('s_local-concurrent')).map((notice) => notice.id),
    ['a', 'b', 'c'],
  );
});

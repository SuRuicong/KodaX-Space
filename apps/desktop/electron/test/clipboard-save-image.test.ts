// OC-31 clipboard handler tests — directly drive the pure helpers
// (saveClipboardImage / cleanupClipboardSession / cleanupClipboardForSession).
// 不走 IPC layer / registerChannel —— 那条路要 Electron ipcMain，单测不需要。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveClipboardImage,
  readNativeClipboardImage,
  cleanupClipboardSession,
  cleanupClipboardForSession,
  assertArtifactPathInClipboardSandbox,
} from '../ipc/clipboard.js';

// 1×1 transparent PNG, base64 — used as a tiny valid image payload.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const TEST_ROOT = path.join(os.tmpdir(), 'kodax-space', 'clipboard');

beforeEach(async () => {
  // 清前一次跑剩下的 (tests 之间互不污染)
  await fs.rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {});
});

test('saveImage: writes file and returns absolute path + byte count', async () => {
  const out = await saveClipboardImage({
    sessionId: 'sess-A',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  assert.ok(path.isAbsolute(out.path), 'returned path should be absolute');
  assert.ok(out.path.endsWith('.png'), 'png ext should be picked from mediaType');
  assert.ok(out.path.includes('sess-A'), 'path should be under sessionId subdir');
  assert.ok(out.bytes > 0, 'bytes > 0');

  const stat = await fs.stat(out.path);
  assert.equal(stat.size, out.bytes, 'on-disk size matches returned bytes');
});

test('saveImage: jpeg media type → .jpg extension', async () => {
  const out = await saveClipboardImage({
    sessionId: 'sess-B',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/jpeg',
  });
  assert.ok(out.path.endsWith('.jpg'));
});

test('saveImage: webp media type → .webp extension', async () => {
  const out = await saveClipboardImage({
    sessionId: 'sess-C',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/webp',
  });
  assert.ok(out.path.endsWith('.webp'));
});

test('readNativeClipboardImage: returns null when SDK sees no clipboard image', async () => {
  const out = await readNativeClipboardImage(
    { sessionId: 'sess-native-empty' },
    {
      readAndNormalizeClipboardImage: async () => null,
      persistImageAsBlock: async () => {
        throw new Error('should not persist an empty clipboard');
      },
    },
  );
  assert.equal(out.image, null);
});

test('readNativeClipboardImage: persists normalized image inside session sandbox', async () => {
  const image = {
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    mediaType: 'image/png' as const,
    width: 1,
    height: 1,
  };
  const out = await readNativeClipboardImage(
    { sessionId: 'sess-native' },
    {
      readAndNormalizeClipboardImage: async () => image,
      persistImageAsBlock: async (normalized, options) => {
        const filePath = path.join(options.directory, 'clipboard-test.png');
        await fs.writeFile(filePath, normalized.buffer);
        return { type: 'image', path: filePath, mediaType: normalized.mediaType };
      },
    },
  );

  assert.ok(out.image);
  assert.equal(out.image.mediaType, 'image/png');
  assert.equal(out.image.base64, image.buffer.toString('base64'));
  assert.equal(out.image.bytes, image.buffer.length);
  assert.equal(out.image.width, 1);
  assert.equal(out.image.height, 1);
  await assertArtifactPathInClipboardSandbox('sess-native', out.image.path);
});

test('saveImage: rejects sessionId with path-traversal chars', async () => {
  await assert.rejects(
    () =>
      saveClipboardImage({
        sessionId: '../escape',
        base64: TINY_PNG_BASE64,
        mediaType: 'image/png',
      }),
    /invalid sessionId/,
  );
  await assert.rejects(
    () =>
      saveClipboardImage({
        sessionId: 'has/slash',
        base64: TINY_PNG_BASE64,
        mediaType: 'image/png',
      }),
    /invalid sessionId/,
  );
});

test('saveImage: rejects empty bytes after base64 decode', async () => {
  await assert.rejects(
    () =>
      saveClipboardImage({
        sessionId: 'sess-D',
        base64: '',
        mediaType: 'image/png',
      }),
    /empty image bytes/,
  );
});

test('saveImage: multiple pastes in same session produce unique filenames', async () => {
  const r1 = await saveClipboardImage({
    sessionId: 'sess-E',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  const r2 = await saveClipboardImage({
    sessionId: 'sess-E',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  assert.notEqual(r1.path, r2.path, 'two pastes must not collide');

  const dir = path.dirname(r1.path);
  const entries = await fs.readdir(dir);
  assert.equal(entries.length, 2);
});

test('cleanupSession: removes the per-session subdir', async () => {
  await saveClipboardImage({
    sessionId: 'sess-F',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  const dir = path.join(TEST_ROOT, 'sess-F');
  assert.ok(
    await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false),
    'dir should exist after save',
  );

  const r = await cleanupClipboardSession({ sessionId: 'sess-F' });
  assert.equal(r.removed, 1);

  const stillThere = await fs
    .stat(dir)
    .then(() => true)
    .catch(() => false);
  assert.equal(stillThere, false, 'dir gone after cleanup');
});

test('cleanupSession: silent no-op when session never wrote any image', async () => {
  const r = await cleanupClipboardSession({ sessionId: 'sess-never-pasted' });
  assert.equal(r.removed, 0);
});

test('cleanupSession: rejects sessionId with path-traversal chars', async () => {
  await assert.rejects(
    () => cleanupClipboardSession({ sessionId: '../escape' }),
    /invalid sessionId/,
  );
});

test('cleanupClipboardForSession (host helper): silent on bad sessionId', async () => {
  // 不抛错；disposeAll 路径不应当因为坏 id 让整个 host 关闭流程崩
  await cleanupClipboardForSession('../malicious');
  await cleanupClipboardForSession('with/slash');
});

test('cleanupClipboardForSession (host helper): removes valid session subdir', async () => {
  await saveClipboardImage({
    sessionId: 'sess-G',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  await cleanupClipboardForSession('sess-G');

  const dir = path.join(TEST_ROOT, 'sess-G');
  const stillThere = await fs
    .stat(dir)
    .then(() => true)
    .catch(() => false);
  assert.equal(stillThere, false);
});

test('files are written with 0o600 mode (owner read/write only)', async () => {
  // Windows 上 mode 不严格起 effect；跳过非 posix
  if (process.platform === 'win32') return;

  const out = await saveClipboardImage({
    sessionId: 'sess-H',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  const stat = await fs.stat(out.path);
  // 低 9 位（user/group/other rwx）应当全部限制到 0o600。
  assert.equal(stat.mode & 0o777, 0o600);
});

// review HIGH-1 fix companion test — per-session dir is 0o700 (owner-only).
test('per-session dir is created with mode 0o700 (owner-only)', async () => {
  if (process.platform === 'win32') return;

  await saveClipboardImage({
    sessionId: 'sess-I',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  const dirStat = await fs.stat(path.join(TEST_ROOT, 'sess-I'));
  assert.equal(dirStat.mode & 0o777, 0o700);
});

// review MEDIUM-5 fix — decoded buffer size enforced even if schema string fits
test('saveImage: rejects images larger than 6 MiB after base64 decode', async () => {
  // 7 MiB of 0xff bytes encoded base64 — schema string max is 12 MiB so it fits
  // through Zod, but the handler must reject because decoded > 6 MiB.
  const big = Buffer.alloc(7 * 1024 * 1024, 0xff);
  await assert.rejects(
    () =>
      saveClipboardImage({
        sessionId: 'sess-too-big',
        base64: big.toString('base64'),
        mediaType: 'image/png',
      }),
    /image too large after decode/,
  );
});

// review HIGH-2 fix companion tests — artifact path validator
test('assertArtifactPathInClipboardSandbox: accepts path from saveClipboardImage', async () => {
  const out = await saveClipboardImage({
    sessionId: 'sess-J',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  // 不应抛
  await assertArtifactPathInClipboardSandbox('sess-J', out.path);
});

test('assertArtifactPathInClipboardSandbox: rejects /etc/passwd-style abs path outside sandbox', async () => {
  const evilPath =
    process.platform === 'win32' ? 'C:\\Windows\\System32\\config\\SAM' : '/etc/passwd';
  await assert.rejects(
    () => assertArtifactPathInClipboardSandbox('sess-K', evilPath),
    /outside clipboard sandbox/,
  );
});

test('assertArtifactPathInClipboardSandbox: rejects path from a different sessionId', async () => {
  // 在 sess-L 存的图，被 sess-M 的 send 引用 — 必须拒绝（跨 session 引用攻击面）
  const out = await saveClipboardImage({
    sessionId: 'sess-L',
    base64: TINY_PNG_BASE64,
    mediaType: 'image/png',
  });
  await assert.rejects(
    () => assertArtifactPathInClipboardSandbox('sess-M', out.path),
    /outside clipboard sandbox/,
  );
});

test('assertArtifactPathInClipboardSandbox: rejects relative paths', async () => {
  await assert.rejects(
    () => assertArtifactPathInClipboardSandbox('sess-N', 'foo/bar.png'),
    /must be absolute/,
  );
  await assert.rejects(
    () => assertArtifactPathInClipboardSandbox('sess-N', './evil.png'),
    /must be absolute/,
  );
});

test('assertArtifactPathInClipboardSandbox: rejects bad sessionId without leaking error', async () => {
  await assert.rejects(
    () => assertArtifactPathInClipboardSandbox('../etc', '/anything'),
    /invalid sessionId/,
  );
});

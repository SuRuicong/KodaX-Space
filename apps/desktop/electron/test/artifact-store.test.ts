// F057 — ArtifactStore: CRUD, versioning, filtering, persistence, caps, resilience.
// Real tmp-dir persistence (DI constructor), no mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { artifactCreateChannel } from '@kodax-space/space-ipc-schema';

function freshStore(): { store: ArtifactStore; dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-store-'));
  const file = join(dir, 'artifacts.json');
  return { store: new ArtifactStore(file, dir), dir, file };
}

const base = { sessionId: 's1', surface: 'partner' as const, kind: 'markdown' as const };

test('create → list (meta only) → read (content)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id, version } = await store.upsert({ ...base, title: 'Doc', content: '# hi' });
    assert.equal(version, 1);

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, id);
    assert.equal(list[0]?.kind, 'markdown');
    assert.equal(list[0]?.currentVersion, 1);
    // list carries metadata only (hasContent flag), not the content itself
    assert.equal(list[0]?.versions[0]?.hasContent, true);
    assert.equal((list[0]?.versions[0] as unknown as { content?: string }).content, undefined);

    const read = await store.read(id);
    assert.equal(read?.content, '# hi');
    assert.equal(read?.version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert with existing id appends a version (iterate)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'v1' });
    const { version } = await store.upsert({ ...base, id, title: 'Doc', content: 'v2' });
    assert.equal(version, 2);

    const list = await store.list();
    assert.equal(list[0]?.currentVersion, 2);
    assert.equal(list[0]?.versions.length, 2);

    assert.equal((await store.read(id))?.content, 'v2'); // default = current
    assert.equal((await store.read(id, 1))?.content, 'v1'); // explicit old version
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list filters by sessionId and surface', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({ sessionId: 'a', surface: 'partner', kind: 'markdown', title: 'A', content: 'x' });
    await store.upsert({ sessionId: 'b', surface: 'code', kind: 'code', title: 'B', content: 'y' });
    assert.equal((await store.list({ sessionId: 'a' })).length, 1);
    assert.equal((await store.list({ surface: 'code' })).length, 1);
    assert.equal((await store.list({ sessionId: 'a', surface: 'code' })).length, 0);
    assert.equal((await store.list()).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doc kind stores a path reference (no inline content)', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({
      sessionId: 's1',
      surface: 'partner',
      kind: 'pdf',
      title: 'Report',
      path: '/proj/report.pdf',
    });
    const meta = (await store.list())[0];
    assert.equal(meta?.versions[0]?.hasContent, false);
    assert.equal(meta?.versions[0]?.path, '/proj/report.pdf');
    const read = await store.read(id);
    assert.equal(read?.path, '/proj/report.pdf');
    assert.equal(read?.content, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delete removes the artifact', async () => {
  const { store, dir } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'x' });
    assert.equal(await store.delete(id), true);
    assert.equal(await store.delete(id), false); // idempotent
    assert.equal((await store.list()).length, 0);
    assert.equal(await store.read(id), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists across store instances (atomic write + reload)', async () => {
  const { store, dir, file } = freshStore();
  try {
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'persisted' });
    assert.ok(existsSync(file));
    // A fresh instance on the same file reloads it.
    const store2 = new ArtifactStore(file, dir);
    const read = await store2.read(id);
    assert.equal(read?.content, 'persisted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt file → starts empty, does not throw', async () => {
  const { store, dir, file } = freshStore();
  try {
    writeFileSync(file, '{ this is not valid json');
    const list = await store.list();
    assert.deepEqual(list, []);
    // still writable after recovering
    const { id } = await store.upsert({ ...base, title: 'Doc', content: 'ok' });
    assert.equal((await store.read(id))?.content, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects content over the size cap', async () => {
  const { store, dir } = freshStore();
  try {
    const huge = 'a'.repeat(1_048_577); // > 1 MB
    await assert.rejects(() => store.upsert({ ...base, title: 'Big', content: huge }), /size limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert: created flag + fresh id on unknown id (no resurrection)', async () => {
  const { store, dir } = freshStore();
  try {
    const r1 = await store.upsert({ ...base, title: 'A', content: 'a' });
    assert.equal(r1.created, true);

    const r2 = await store.upsert({ ...base, id: r1.id, title: 'A', content: 'b' });
    assert.equal(r2.created, false); // appended a version
    assert.equal(r2.id, r1.id);

    // unknown id → brand-new artifact with a FRESH id, never the stale one
    const r3 = await store.upsert({ ...base, id: 'does-not-exist', title: 'C', content: 'c' });
    assert.equal(r3.created, true);
    assert.notEqual(r3.id, 'does-not-exist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- schema (IPC boundary) validation ----

const parseCreate = (v: unknown) => artifactCreateChannel.input.safeParse(v);

test('create schema: valid content artifact passes', () => {
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'markdown', title: 'T', content: '# x' }).success, true);
});

test('create schema: doc kind requires path, content kind requires content', () => {
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T' }).success, false); // pdf, no path
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T', path: '/p/a.pdf' }).success, true);
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'markdown', title: 'T' }).success, false); // md, no content
});

test('create schema: rejects NUL/CR/LF in path', () => {
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T', path: `/p/a${String.fromCharCode(0)}.pdf` }).success, false);
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'pdf', title: 'T', path: '/p/a\n.pdf' }).success, false);
});

test('create schema: content cap is UTF-8 bytes (multibyte over byte budget rejected)', () => {
  // 600k '中' chars = 1.8 MB UTF-8 (>1 MB) but < 1,048,576 chars → byte refine must reject.
  const multibyte = '中'.repeat(600_000);
  assert.equal(parseCreate({ sessionId: 's', surface: 'partner', kind: 'markdown', title: 'T', content: multibyte }).success, false);
});

test('concurrent upserts all land (write-lock serialization)', async () => {
  const { store, dir } = freshStore();
  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.upsert({ ...base, title: `T${i}`, content: `c${i}` }),
      ),
    );
    assert.equal((await store.list()).length, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

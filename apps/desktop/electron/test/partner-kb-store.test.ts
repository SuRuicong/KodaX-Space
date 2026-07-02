import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerKbStore } from '../kodax/partner-kb-store.js';

function freshStore(): { store: PartnerKbStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'partner-kb-store-'));
  return { store: new PartnerKbStore(join(dir, 'partner-kb.json')), dir };
}

test('PartnerKbStore creates, lists, reads, and updates pages by slug', async () => {
  const { store, dir } = freshStore();
  try {
    const created = await store.upsert({
      projectRoot: '/project',
      title: 'Design Notes',
      content: '# v1',
    });
    assert.equal(created.created, true);
    assert.equal(created.page.slug, 'design-notes');
    assert.equal((await store.list('/project')).length, 1);
    assert.equal((await store.get('/project', { slug: 'design-notes' }))?.content, '# v1');

    const updated = await store.upsert({
      projectRoot: '/project',
      title: 'Design Notes',
      content: '# v2',
      slug: 'design-notes',
    });
    assert.equal(updated.created, false);
    assert.equal(updated.page.id, created.page.id);
    assert.equal((await store.list('/project')).length, 1);
    assert.equal((await store.get('/project', { id: created.page.id }))?.content, '# v2');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PartnerKbStore isolates pages by project root', async () => {
  const { store, dir } = freshStore();
  try {
    await store.upsert({ projectRoot: '/a', title: 'Shared', content: 'A' });
    await store.upsert({ projectRoot: '/b', title: 'Shared', content: 'B' });
    assert.equal((await store.list('/a')).length, 1);
    assert.equal((await store.list('/b')).length, 1);
    assert.equal((await store.get('/a', { slug: 'shared' }))?.content, 'A');
    assert.equal((await store.get('/b', { slug: 'shared' }))?.content, 'B');
  } finally {
    store.invalidate();
    rmSync(dir, { recursive: true, force: true });
  }
});

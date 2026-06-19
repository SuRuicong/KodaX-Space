import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HANDOFF_MAX_AGE_MS,
  acceptHandoffInDir,
  dismissHandoffInDir,
  listHandoffsInDir,
  readHandoffFile,
} from '../ipc/handoff.js';

function freshDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'handoff-ipc-'));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(value), 'utf8');
}

test('readHandoffFile accepts valid payload aliases and detects stale files', async () => {
  const dir = freshDir();
  const now = Date.parse('2026-06-19T00:00:00.000Z');
  try {
    const validFile = path.join(dir, 'valid.json');
    await writeJson(validFile, {
      session_id: 'sess_1',
      cwd: 'C:/repo',
      from: 'cli',
      created_at: new Date(now).toISOString(),
    });
    assert.deepEqual(await readHandoffFile(validFile, now), {
      id: 'valid',
      filePath: validFile,
      status: 'valid',
      sessionId: 'sess_1',
      projectRoot: 'C:/repo',
      source: 'cli',
      createdAt: now,
    });

    const staleFile = path.join(dir, 'stale.json');
    await writeJson(staleFile, {
      sessionId: 'sess_2',
      projectRoot: 'C:/repo',
      createdAt: now - HANDOFF_MAX_AGE_MS - 1,
    });
    const stale = await readHandoffFile(staleFile, now);
    assert.equal(stale.status, 'stale');
    assert.match(stale.error ?? '', /older than 24 hours/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listHandoffsInDir returns invalid files instead of throwing and ignores non-json files', async () => {
  const dir = freshDir();
  const now = Date.parse('2026-06-19T00:00:00.000Z');
  try {
    await writeJson(path.join(dir, 'newer.json'), {
      sessionId: 'sess_new',
      projectRoot: 'C:/repo',
      createdAt: now,
    });
    await writeJson(path.join(dir, 'older.json'), {
      sessionId: 'sess_old',
      projectRoot: 'C:/repo',
      createdAt: now - 1000,
    });
    await fsp.writeFile(path.join(dir, 'bad.json'), '{not-json', 'utf8');
    await fsp.writeFile(path.join(dir, 'note.txt'), 'ignore me', 'utf8');

    const handoffs = await listHandoffsInDir(dir, now);
    assert.equal(handoffs.length, 3);
    assert.equal(handoffs[0]?.id, 'newer');
    assert.equal(handoffs[1]?.id, 'older');
    assert.equal(handoffs[2]?.id, 'bad');
    assert.equal(handoffs[2]?.status, 'invalid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acceptHandoffInDir uses expectedSessionId guard and removes only accepted files', async () => {
  const dir = freshDir();
  const file = path.join(dir, 'handoff.json');
  try {
    await writeJson(file, {
      sessionId: 'sess_1',
      projectRoot: 'C:/repo',
      createdAt: Date.now(),
    });

    assert.deepEqual(await acceptHandoffInDir(dir, { handoffId: 'handoff', expectedSessionId: 'other' }), {
      accepted: false,
      removed: false,
      error: 'handoff changed before accept: sess_1',
    });
    assert.equal(existsSync(file), true);

    assert.deepEqual(await acceptHandoffInDir(dir, { handoffId: 'handoff', expectedSessionId: 'sess_1' }), {
      accepted: true,
      removed: true,
      sessionId: 'sess_1',
      projectRoot: 'C:/repo',
    });
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dismissHandoffInDir removes invalid descriptors too', async () => {
  const dir = freshDir();
  const file = path.join(dir, 'bad.json');
  try {
    await fsp.writeFile(file, '{not-json', 'utf8');
    assert.deepEqual(await dismissHandoffInDir(dir, { handoffId: 'bad' }), {
      dismissed: true,
      removed: true,
    });
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

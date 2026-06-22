import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../settings/store.js';

let tmpDir = '';
let settingsFile = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-space-settings-'));
  settingsFile = path.join(tmpDir, 'settings.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('load backfills languageMode for older settings files', async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(
    settingsFile,
    JSON.stringify({ version: 1, defaultWorkspace: path.join(tmpDir, 'workspace') }),
    'utf-8',
  );

  const store = new SettingsStore(settingsFile, tmpDir);
  const loaded = await store.load();

  assert.equal(loaded.defaultWorkspace, path.join(tmpDir, 'workspace'));
  assert.equal(loaded.languageMode, 'system');
});

test('setLanguageMode persists without changing defaultWorkspace', async () => {
  const workspace = path.join(tmpDir, 'workspace');
  const store = new SettingsStore(settingsFile, tmpDir);
  await store.setDefaultWorkspace(workspace);

  const next = await store.setLanguageMode('en-US');
  assert.equal(next.defaultWorkspace, workspace);
  assert.equal(next.languageMode, 'en-US');

  const reloaded = await new SettingsStore(settingsFile, tmpDir).load();
  assert.equal(reloaded.defaultWorkspace, workspace);
  assert.equal(reloaded.languageMode, 'en-US');
});

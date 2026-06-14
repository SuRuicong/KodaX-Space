// P1b — sandboxHost lifecycle: best-effort start, info reporting, dispose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxHost } from '../artifact/sandbox-host.js';

// NOTE: these tests share the process-global `sandboxHost` singleton. node:test
// runs them sequentially and each test's `finally` calls dispose() to reset
// state, so order independence holds. If this file grows, prefer exporting the
// SandboxHost class for per-test instances.

function makeFixtureRepo(): { repoRoot: string; bundleRoot: string } {
  // Lay out a fake Space repo so defaultBundleCandidates' env override is used;
  // we drive resolution via envOverride to avoid depending on a real LC sibling.
  const repoRoot = mkdtempSync(join(tmpdir(), 'space-repo-'));
  const bundleRoot = join(repoRoot, 'bundle');
  mkdirSync(join(bundleRoot, '_next'), { recursive: true });
  writeFileSync(join(bundleRoot, 'index.html'), '<!doctype html><body>shell</body>');
  return { repoRoot, bundleRoot };
}

test('sandboxHost: not ready (with diagnostic) when no bundle found', async () => {
  const { repoRoot } = makeFixtureRepo();
  try {
    const info = await sandboxHost.start({
      spaceRepoRoot: repoRoot,
      parentOrigin: 'http://localhost:5173',
      envOverride: join(repoRoot, 'nonexistent'),
    });
    assert.equal(info.ready, false);
    assert.match(info.error ?? '', /build:bundle|bundle/);
    assert.equal(info.sandboxOrigin, undefined);
  } finally {
    await sandboxHost.dispose();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('sandboxHost: ready + serves + idempotent start + dispose', async () => {
  const { repoRoot, bundleRoot } = makeFixtureRepo();
  try {
    const info = await sandboxHost.start({
      spaceRepoRoot: repoRoot,
      parentOrigin: 'http://localhost:5173',
      envOverride: bundleRoot,
    });
    assert.equal(info.ready, true);
    assert.match(info.sandboxOrigin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(info.indexUrl, `${info.sandboxOrigin}/_sandbox/index.html`);

    // server actually serves the fixture index
    const res = await fetch(info.indexUrl!);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('shell'));

    // idempotent: second start returns same info, no second server
    const again = await sandboxHost.start({
      spaceRepoRoot: repoRoot,
      parentOrigin: 'http://localhost:5173',
      envOverride: bundleRoot,
    });
    assert.equal(again.sandboxOrigin, info.sandboxOrigin);

    await sandboxHost.dispose();
    assert.equal(sandboxHost.getInfo().ready, false);
  } finally {
    await sandboxHost.dispose();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

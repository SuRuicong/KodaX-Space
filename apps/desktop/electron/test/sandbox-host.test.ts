// P1b — sandboxHost lifecycle: best-effort start, info reporting, dispose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxHost } from '../artifact/sandbox-host.js';

// NOTE: these tests share the process-global `sandboxHost` singleton. node:test
// runs them sequentially and each test's `finally` calls dispose() to reset
// state, so order independence holds. The `bundleCandidates` seam keeps tests
// hermetic — the real linked @kodax-ai/livecanvas-sandbox-shell is NOT consulted.

function makeFixtureBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-host-fixture-'));
  mkdirSync(join(root, '_next'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head></head><body>shell</body></html>');
  return root;
}

test('sandboxHost: not ready (with diagnostic) when no bundle found', async () => {
  try {
    const info = await sandboxHost.start({
      parentOrigin: 'http://localhost:5173',
      bundleCandidates: [join(tmpdir(), 'definitely-not-a-bundle-xyz')],
    });
    assert.equal(info.ready, false);
    assert.match(info.error ?? '', /bundle|link:livecanvas/);
    assert.equal(info.sandboxOrigin, undefined);
  } finally {
    await sandboxHost.dispose();
  }
});

test('sandboxHost: ready + serves + idempotent start + dispose', async () => {
  const bundleRoot = makeFixtureBundle();
  try {
    const info = await sandboxHost.start({
      parentOrigin: 'http://localhost:5173',
      bundleCandidates: [bundleRoot],
    });
    assert.equal(info.ready, true);
    assert.match(info.sandboxOrigin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(info.indexUrl ?? '', /\/index\.html\?lc_parent_origin=/);
    // shellVersion is undefined when the test seam bypasses the real package.
    assert.equal(info.shellVersion, undefined);

    // server actually serves the fixture index (with injection)
    const res = await fetch(info.indexUrl!);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('shell'));
    assert.match(html, /__LC_TRUSTED_PARENT_ORIGINS__/);

    // idempotent: second start returns same info, no second server
    const again = await sandboxHost.start({
      parentOrigin: 'http://localhost:5173',
      bundleCandidates: [bundleRoot],
    });
    assert.equal(again.sandboxOrigin, info.sandboxOrigin);

    await sandboxHost.dispose();
    assert.equal(sandboxHost.getInfo().ready, false);
  } finally {
    await sandboxHost.dispose();
    rmSync(bundleRoot, { recursive: true, force: true });
  }
});

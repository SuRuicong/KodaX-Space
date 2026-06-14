// P1a — sandbox static-server + bundle-resolver unit/integration tests.
//
// Uses a SYNTHETIC bundle fixture (a temp dir mimicking the Next static export
// shape: index.html + _next/static/*.js + index.txt). This exercises Space's own
// HTTP-serving contract (routing / path-safety / MIME / CSP / passthrough) — NOT
// the LiveCanvas shell's render behaviour, which needs the real bundle and is
// verified live in P1c (记忆 feedback_mock_fidelity: 真边界不靠 mock；这里的边界是
// 我方静态服务，fixture 是真文件真请求，合规).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  frameAncestors,
  isBareOrigin,
  handleSandboxRoute,
  startSandboxServer,
} from '../artifact/sandbox-server.js';
import {
  resolveSandboxBundle,
  isMountableBundle,
  defaultBundleCandidates,
} from '../artifact/bundle-resolver.js';

const PARENT = 'http://localhost:5173';

function makeFixtureBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-sandbox-fixture-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><script src="/_next/static/app.js"></script></head><body>shell</body></html>');
  writeFileSync(join(root, 'index.txt'), 'rsc-payload');
  mkdirSync(join(root, '_next', 'static'), { recursive: true });
  writeFileSync(join(root, '_next', 'static', 'app.js'), 'console.log("chunk")');
  return root;
}

// ---- bundle-resolver --------------------------------------------------------

test('isMountableBundle: true only when dir has index.html', () => {
  const root = makeFixtureBundle();
  try {
    assert.equal(isMountableBundle(root), true);
    assert.equal(isMountableBundle(join(root, '_next')), false); // no index.html
    assert.equal(isMountableBundle(join(root, 'does-not-exist')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: env override wins and is validated', () => {
  const root = makeFixtureBundle();
  try {
    const r = resolveSandboxBundle({ envOverride: root, lcRepoCandidates: ['/nope'] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolution.source, 'env');
      assert.equal(r.resolution.root, root);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: falls through env→local→lc-repo, picks first mountable', () => {
  const root = makeFixtureBundle();
  try {
    const r = resolveSandboxBundle({
      envOverride: join(root, 'missing'), // exists? no → skip
      localCandidates: [join(root, '_next')], // exists but no index.html → skip
      lcRepoCandidates: [root], // mountable → win
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolution.source, 'lc-repo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: error result lists what was tried', () => {
  const r = resolveSandboxBundle({ localCandidates: ['/a/b'], lcRepoCandidates: ['/c/d'] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.tried.length, 2);
    assert.match(r.reason, /build:bundle/);
  }
});

test('defaultBundleCandidates: derives LC sibling-repo path two levels up', () => {
  const { local, lcRepo } = defaultBundleCandidates('/x/Works/KodaX-Space');
  assert.ok(local[0]?.includes('resources'));
  assert.ok(lcRepo[0]?.replace(/\\/g, '/').endsWith('LiveCanvas/packages/cli/dist/sandbox-shell-static'));
});

// ---- pure router ------------------------------------------------------------

test('frameAncestors: includes parent origin, falls back to self only', () => {
  assert.equal(frameAncestors(PARENT), `frame-ancestors 'self' ${PARENT}`);
  assert.equal(frameAncestors(''), "frame-ancestors 'self'");
});

test('isBareOrigin: accepts http(s)/app origins, rejects paths & injection', () => {
  assert.equal(isBareOrigin('http://localhost:5173'), true);
  assert.equal(isBareOrigin('https://example.com'), true);
  assert.equal(isBareOrigin('app://space'), true); // F055 forward-compat
  assert.equal(isBareOrigin('http://x/path'), false); // has path
  assert.equal(isBareOrigin('http://x ;frame-ancestors *'), false); // injection
  assert.equal(isBareOrigin('http://x\r\nSet-Cookie: a=b'), false); // CRLF
});

test('frameAncestors: NEVER injects a malformed value (CSP/header-injection guard)', () => {
  assert.equal(frameAncestors("http://x'; script-src *"), "frame-ancestors 'self'");
  assert.equal(frameAncestors('http://evil\r\nX: y'), "frame-ancestors 'self'");
});

test('handleSandboxRoute: /_sandbox exact (no slash) → serves index.html', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_sandbox');
    assert.equal(r.status, 200);
    assert.match(r.headers['Content-Type'] ?? '', /text\/html/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: 404 for unknown path still carries CSP', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/nope');
    assert.equal(r.status, 404);
    assert.equal(r.headers['Content-Security-Policy'], frameAncestors(PARENT));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: symlink inside bundle pointing OUTSIDE is forbidden (403)', (t) => {
  const root = makeFixtureBundle();
  const outside = mkdtempSync(join(tmpdir(), 'lc-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET');
  try {
    // Symlink creation needs privilege/Developer Mode on Windows — skip if denied.
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'), 'file');
    } catch {
      t.skip('symlink creation not permitted in this environment');
      return;
    }
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_sandbox/leak.txt');
    assert.equal(r.status, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: /_sandbox/index.html → 200 html with CSP', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_sandbox/index.html');
    assert.equal(r.status, 200);
    assert.match(r.headers['Content-Type'] ?? '', /text\/html/);
    assert.equal(r.headers['Content-Security-Policy'], frameAncestors(PARENT));
    assert.ok(r.body?.toString().includes('shell'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: root-relative /_next/* passthrough served from bundle root', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_next/static/app.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['Content-Type'] ?? '', /javascript/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: /index.txt exact passthrough, but /robots.txt does not leak', () => {
  const root = makeFixtureBundle();
  try {
    assert.equal(handleSandboxRoute(root, PARENT, 'GET', '/index.txt').status, 200);
    assert.equal(handleSandboxRoute(root, PARENT, 'GET', '/robots.txt').status, 404);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: path traversal is forbidden (403)', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_sandbox/../../../etc/passwd');
    assert.equal(r.status, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: non-GET/HEAD on sandbox path → 405', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'POST', '/_sandbox/index.html');
    assert.equal(r.status, 405);
    assert.equal(r.headers.Allow, 'GET, HEAD');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: HEAD omits body but keeps status/headers', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'HEAD', '/_sandbox/index.html');
    assert.equal(r.status, 200);
    assert.equal(r.body, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: /health → 200 json', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.match(r.body?.toString() ?? '', /healthy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- live loopback server ---------------------------------------------------

test('startSandboxServer: binds 127.0.0.1, serves over real HTTP, closes clean', async () => {
  const root = makeFixtureBundle();
  const srv = await startSandboxServer({ bundleRoot: root, parentOrigin: PARENT });
  try {
    assert.match(srv.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(srv.indexUrl, `${srv.origin}/_sandbox/index.html`);

    const res = await fetch(srv.indexUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('content-security-policy'), frameAncestors(PARENT));
    assert.ok((await res.text()).includes('shell'));

    const chunk = await fetch(`${srv.origin}/_next/static/app.js`);
    assert.equal(chunk.status, 200);

    const traversal = await fetch(`${srv.origin}/_sandbox/%2e%2e%2f%2e%2e%2fetc/passwd`);
    assert.equal(traversal.status, 403);
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('startSandboxServer: refuses a non-loopback host', async () => {
  const root = makeFixtureBundle();
  try {
    await assert.rejects(
      () => startSandboxServer({ bundleRoot: root, parentOrigin: PARENT, host: '0.0.0.0' }),
      /non-loopback/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('startSandboxServer: rejects a malformed parentOrigin', async () => {
  const root = makeFixtureBundle();
  try {
    await assert.rejects(
      () => startSandboxServer({ bundleRoot: root, parentOrigin: 'http://x\r\nX: y' }),
      /parentOrigin/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

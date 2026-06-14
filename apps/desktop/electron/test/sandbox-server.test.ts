// P1a — sandbox static-server + bundle-resolver unit/integration tests.
//
// Uses a SYNTHETIC bundle fixture (a temp dir mimicking the standalone package's
// static export: index.html at root + _next/static/*.js + index.txt). This
// exercises Space's own HTTP-serving contract (root routing / path-safety / MIME /
// CSP / trusted-origins injection) — NOT the LiveCanvas shell's render behaviour,
// which is verified live in P1c (记忆 feedback_mock_fidelity).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  frameAncestors,
  isBareOrigin,
  injectTrustedOrigins,
  handleSandboxRoute,
  startSandboxServer,
} from '../artifact/sandbox-server.js';
import {
  resolveSandboxBundle,
  isMountableBundle,
} from '../artifact/bundle-resolver.js';

const PARENT = 'http://localhost:5173';

function makeFixtureBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-sandbox-fixture-'));
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head><script src="/_next/static/app.js"></script></head><body>shell</body></html>',
  );
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
    const r = resolveSandboxBundle({ envOverride: root, packageCandidates: ['/nope'] });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolution.source, 'env');
      assert.equal(r.resolution.root, root);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: non-absolute env override is ignored, falls to package', () => {
  const root = makeFixtureBundle();
  try {
    const r = resolveSandboxBundle({ envOverride: 'relative/path', packageCandidates: [root] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolution.source, 'package');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: picks first mountable package candidate', () => {
  const root = makeFixtureBundle();
  try {
    const r = resolveSandboxBundle({ packageCandidates: [join(root, '_next'), root] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolution.source, 'package');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSandboxBundle: error result lists what was tried + actionable hint', () => {
  const r = resolveSandboxBundle({ packageCandidates: ['/a/b'] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.tried.length, 1);
    assert.match(r.reason, /link:livecanvas|SPACE_LC_SANDBOX_BUNDLE/);
  }
});

// ---- origin / CSP / injection helpers --------------------------------------

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

test('injectTrustedOrigins: inserts script before </head> for valid origin; no-op otherwise', () => {
  const html = '<html><head><title>x</title></head><body>b</body></html>';
  const out = injectTrustedOrigins(html, 'app://space');
  assert.match(out, /__LC_TRUSTED_PARENT_ORIGINS__=\["app:\/\/space"\]/);
  assert.ok(out.indexOf('__LC_TRUSTED') < out.indexOf('</head>')); // before </head>
  assert.equal(injectTrustedOrigins(html, ''), html); // empty → untouched
  assert.equal(injectTrustedOrigins(html, 'http://x ;evil'), html); // invalid → untouched
});

// ---- pure router (root serving) --------------------------------------------

test('handleSandboxRoute: / and /index.html → 200 html with CSP + injected origins', () => {
  const root = makeFixtureBundle();
  try {
    for (const p of ['/', '/index.html']) {
      const r = handleSandboxRoute(root, PARENT, 'GET', p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers['Content-Type'] ?? '', /text\/html/);
      assert.equal(r.headers['Content-Security-Policy'], frameAncestors(PARENT));
      assert.equal(r.headers['Cache-Control'], 'no-store');
      assert.match(r.body?.toString() ?? '', /__LC_TRUSTED_PARENT_ORIGINS__/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: root-relative /_next/* served from bundle root', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/_next/static/app.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['Content-Type'] ?? '', /javascript/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: /index.txt served; missing file → 404 with CSP', () => {
  const root = makeFixtureBundle();
  try {
    assert.equal(handleSandboxRoute(root, PARENT, 'GET', '/index.txt').status, 200);
    const miss = handleSandboxRoute(root, PARENT, 'GET', '/robots.txt');
    assert.equal(miss.status, 404);
    assert.equal(miss.headers['Content-Security-Policy'], frameAncestors(PARENT));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: path traversal is forbidden (403)', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'GET', '/../../../etc/passwd');
    assert.equal(r.status, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: non-GET/HEAD → 405', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'POST', '/index.html');
    assert.equal(r.status, 405);
    assert.equal(r.headers.Allow, 'GET, HEAD');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handleSandboxRoute: HEAD omits body but keeps status/headers', () => {
  const root = makeFixtureBundle();
  try {
    const r = handleSandboxRoute(root, PARENT, 'HEAD', '/index.html');
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

test('handleSandboxRoute: symlink inside bundle pointing OUTSIDE is forbidden (403)', (t) => {
  const root = makeFixtureBundle();
  const outside = mkdtempSync(join(tmpdir(), 'lc-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET');
  try {
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'), 'file');
    } catch {
      t.skip('symlink creation not permitted in this environment');
      return;
    }
    const r = handleSandboxRoute(root, PARENT, 'GET', '/leak.txt');
    assert.equal(r.status, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---- live loopback server ---------------------------------------------------

test('startSandboxServer: binds 127.0.0.1, serves over real HTTP, injects, closes', async () => {
  const root = makeFixtureBundle();
  const srv = await startSandboxServer({ bundleRoot: root, parentOrigin: PARENT });
  try {
    assert.match(srv.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(srv.indexUrl, `${srv.origin}/index.html?lc_parent_origin=${encodeURIComponent(PARENT)}`);

    const res = await fetch(srv.indexUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('content-security-policy'), frameAncestors(PARENT));
    const html = await res.text();
    assert.ok(html.includes('shell'));
    assert.match(html, /__LC_TRUSTED_PARENT_ORIGINS__/); // injected

    const chunk = await fetch(`${srv.origin}/_next/static/app.js`);
    assert.equal(chunk.status, 200);

    const traversal = await fetch(`${srv.origin}/%2e%2e%2f%2e%2e%2fetc/passwd`);
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

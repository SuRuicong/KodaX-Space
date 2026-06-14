// Loopback HTTP server that hosts the LiveCanvas sandbox-shell static bundle.
//
// 路径 D (记忆 livecanvas_artifact_plan): Space self-hosts the sandbox bundle on
// 127.0.0.1 so the renderer's ArtifactPanel <iframe> can load it on a real http
// origin (the sandbox child), while the renderer itself is the parent frame.
// The parent↔child postMessage handshake is done in the renderer via
// @livecanvas/sandbox-bridge `createHost`.
//
// Why a loopback server and not app:// for the sandbox too: keeping the Next.js
// static export on a normal http origin (its expected runtime) minimises risk on
// the unverified LC-shell boundary. (Renderer migrates to app:// separately —
// F055 — for the PARENT origin in the packaged build.)
//
// Security:
//   - binds 127.0.0.1 only (never 0.0.0.0).
//   - serves GET/HEAD only; everything else 404/405.
//   - path-traversal safe (static-serve.safeResolve).
//   - sets `frame-ancestors 'self' <parentOrigin>` so only the Space renderer
//     may frame the sandbox (a rogue local page cannot embed it).

import { createServer, type Server } from 'node:http';
import { serveStaticAsset, type StaticServeResult } from './static-serve.js';

/** Canonical iframe mount prefix. */
const SANDBOX_MOUNT = '/_sandbox';
// The bundled sandbox-shell index.html bakes root-relative `/_next/...` chunk
// URLs and a sibling `/index.txt` (Next 15 RSC payload). Loaded at
// /_sandbox/index.html, those resolve against the origin ROOT — so we mirror
// them from the bundle root. `/index.txt` is exact-match so unrelated root paths
// (e.g. /robots.txt) don't leak into the static dir.
const ROOT_PASSTHROUGH = ['/_next/', '/index.txt'] as const;

// A bare origin: scheme://authority, no path/query, no whitespace, no chars that
// could break out of a CSP token or inject an HTTP header (CR/LF/;/quotes/\/, ).
// Scheme is left flexible so F055's app://space passes alongside http(s) origins.
const BARE_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/\\;,'"]+$/i;

export function isBareOrigin(value: string): boolean {
  return BARE_ORIGIN_RE.test(value);
}

export interface SandboxRoute {
  status: number;
  headers: Record<string, string>;
  body: Buffer | null;
}

/**
 * Build the `frame-ancestors` CSP value. `'self'` lets the sandbox frame its own
 * sub-resources; `parentOrigin` (the Space renderer origin) is the only external
 * framer allowed. Empty OR malformed parentOrigin → `'self'` only — we never
 * inject an unvalidated value into the header (CSP/header-injection guard).
 */
export function frameAncestors(parentOrigin: string): string {
  const trimmed = parentOrigin.trim();
  if (!trimmed || !isBareOrigin(trimmed)) return "frame-ancestors 'self'";
  return `frame-ancestors 'self' ${trimmed}`;
}

/**
 * Pure router: map (method, urlPath) → a static-serve result with sandbox CSP.
 * Unit-testable without a live socket.
 */
export function handleSandboxRoute(
  bundleRoot: string,
  parentOrigin: string,
  method: string,
  urlPath: string,
): SandboxRoute {
  const csp = frameAncestors(parentOrigin);
  const m = method.toUpperCase();

  if (urlPath === '/health' && (m === 'GET' || m === 'HEAD')) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: m === 'HEAD' ? null : Buffer.from(JSON.stringify({ ok: true, data: { status: 'healthy' } })),
    };
  }

  const isSandbox = urlPath === SANDBOX_MOUNT || urlPath.startsWith(`${SANDBOX_MOUNT}/`);
  const isPassthrough = ROOT_PASSTHROUGH.some((p) => (p.endsWith('/') ? urlPath.startsWith(p) : urlPath === p));
  if (!isSandbox && !isPassthrough) {
    return {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Security-Policy': csp },
      body: bodyFor(m, '{"ok":false,"error":{"code":"NOT_FOUND"}}'),
    };
  }

  if (m !== 'GET' && m !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD' }, body: null };
  }

  const rel = isSandbox ? urlPath.slice(SANDBOX_MOUNT.length) || '/' : urlPath;
  const result: StaticServeResult = serveStaticAsset(bundleRoot, rel);
  return {
    status: result.status,
    headers: { ...result.headers, 'Content-Security-Policy': csp },
    body: m === 'HEAD' ? null : result.body,
  };
}

function bodyFor(method: string, json: string): Buffer | null {
  return method === 'HEAD' ? null : Buffer.from(json);
}

export interface SandboxServer {
  /** Bare origin, e.g. http://127.0.0.1:54123 — pass to createHost as sandboxOrigin. */
  origin: string;
  port: number;
  /** Full iframe src for the shell entry. */
  indexUrl: string;
  close: () => Promise<void>;
}

export interface StartSandboxServerOptions {
  bundleRoot: string;
  /** Space renderer origin (the parent frame). Dev: http://localhost:5173. */
  parentOrigin: string;
  /** Bind host — always loopback. Override only for tests. */
  host?: string;
  /** Bind port. 0 = ephemeral (default). */
  port?: number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Start the loopback sandbox server and resolve once it is listening. */
export function startSandboxServer(opts: StartSandboxServerOptions): Promise<SandboxServer> {
  const host = opts.host ?? '127.0.0.1';
  // Refuse to ever bind a non-loopback interface — the sandbox must not be
  // reachable from other machines on the network.
  if (!LOOPBACK_HOSTS.has(host) && !host.startsWith('127.')) {
    return Promise.reject(new Error(`sandbox-server: refusing to bind non-loopback host: ${host}`));
  }
  // Fail fast on a malformed parentOrigin rather than silently degrading the
  // framing guard to 'self' only (which would also reject the real renderer).
  if (opts.parentOrigin && !isBareOrigin(opts.parentOrigin.trim())) {
    return Promise.reject(new Error(`sandbox-server: parentOrigin is not a bare origin: ${opts.parentOrigin}`));
  }
  const server = createServer((req, res) => {
    const route = handleSandboxRoute(opts.bundleRoot, opts.parentOrigin, req.method ?? 'GET', new URL(req.url ?? '/', 'http://placeholder').pathname);
    res.writeHead(route.status, route.headers);
    res.end(route.body ?? undefined);
  });

  return new Promise<SandboxServer>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        void closeServer(server);
        reject(new Error('sandbox-server: failed to obtain bound port'));
        return;
      }
      const origin = `http://${host}:${addr.port}`;
      resolvePromise({
        origin,
        port: addr.port,
        indexUrl: `${origin}${SANDBOX_MOUNT}/index.html`,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((err) => (err ? reject(err) : resolvePromise()));
    server.closeAllConnections?.();
  });
}

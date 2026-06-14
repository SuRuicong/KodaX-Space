// Loopback HTTP server that hosts the LiveCanvas sandbox-shell static bundle.
//
// 路径 D (记忆 livecanvas_artifact_plan): Space self-hosts the sandbox bundle
// (@kodax-ai/livecanvas-sandbox-shell, served from getStaticDir()) on 127.0.0.1
// so the renderer's ArtifactPanel <iframe> can load it on a real http origin (the
// sandbox child), while the renderer itself is the parent frame. The parent↔child
// postMessage handshake runs in the renderer via @livecanvas/sandbox-bridge
// `createHost`.
//
// Consumption model (per LC integration): serve the whole static dir at ROOT
// (index.html at `/`, chunks at `/_next/*`), and inject the host's trusted parent
// origin into the served index.html via the shell's
// `window.__LC_TRUSTED_PARENT_ORIGINS__` channel (renderTrustedOriginsScript).
// The iframe loads `<origin>/index.html?lc_parent_origin=<parentOrigin>`; the URL
// param is only compared against the injected/baked allowlist, never trusted alone.
//
// Why loopback http (not app://) for the sandbox: keeps the Next static export on
// its expected http origin, minimising risk on the LC-shell boundary. The RENDERER
// migrates to app:// separately (F055) for the PARENT origin in the packaged build.
//
// Security: binds 127.0.0.1 only; GET/HEAD only; path-traversal + symlink-escape
// safe (static-serve); `frame-ancestors 'self' <parentOrigin>` so only the Space
// renderer may frame the sandbox; parentOrigin validated before header injection.

import { createServer, type Server } from 'node:http';
import { serveStaticAsset, type StaticServeResult } from './static-serve.js';

// The shell reads this window global at boot for host-injected trusted parent
// origins. Mirrors @kodax-ai/livecanvas-sandbox-shell's renderTrustedOriginsScript
// (SOT) — inlined rather than imported so test-reachable modules don't load that
// package (its dist does createRequire('../package.json'), which the tsx/esm test
// loader mis-parses). The global name + JSON shape are a stable LC contract.
const TRUSTED_PARENT_ORIGINS_GLOBAL = '__LC_TRUSTED_PARENT_ORIGINS__';

function renderTrustedOriginsScript(origins: readonly string[]): string {
  const json = JSON.stringify(origins).replace(/</g, '\\u003c');
  return `<script>window.${TRUSTED_PARENT_ORIGINS_GLOBAL}=${json};</script>`;
}

// A bare origin: scheme://authority, no path/query, no whitespace, and none of
// the chars that could break out of a CSP token, inject an HTTP header
// (CR/LF/;/quotes/\/, ), or smuggle a percent-encoded control char (%). Scheme is
// left flexible so F055's app://space passes alongside http(s) origins (URL.origin
// can't be used — it returns "null" for non-special schemes like app://).
const BARE_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/\\;,'"%]+$/i;

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

/** Inject the trusted-parent-origins script into the served index.html (before </head>). */
export function injectTrustedOrigins(html: string, parentOrigin: string): string {
  const trimmed = parentOrigin.trim();
  if (!trimmed || !isBareOrigin(trimmed)) return html;
  const snippet = renderTrustedOriginsScript([trimmed]);
  // Insert before the LAST </head> (robust even if an earlier comment/string in
  // the HTML contains the token). The shell must read the global before its own
  // bundle script runs; the real index.html has a single real </head>.
  const idx = html.lastIndexOf('</head>');
  return idx === -1 ? `${snippet}${html}` : html.slice(0, idx) + snippet + html.slice(idx);
}

/**
 * Pure router: map (method, urlPath) → a static-serve result with sandbox CSP.
 * Serves the bundle at root; patches the root index.html with the trusted-origins
 * script. Unit-testable without a live socket.
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
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp },
      body: m === 'HEAD' ? null : Buffer.from(JSON.stringify({ ok: true, data: { status: 'healthy' } })),
    };
  }

  if (m !== 'GET' && m !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Security-Policy': csp }, body: null };
  }

  // Root → index.html (the shell entry).
  const isIndex = urlPath === '/' || urlPath === '/index.html';
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const result: StaticServeResult = serveStaticAsset(bundleRoot, rel);

  let body = result.body;
  const headers: Record<string, string> = { ...result.headers, 'Content-Security-Policy': csp };
  if (result.status === 200 && isIndex && body) {
    // Patch the trusted parent origin into the HTML the shell reads at boot.
    body = Buffer.from(injectTrustedOrigins(body.toString('utf8'), parentOrigin));
    headers['Cache-Control'] = 'no-store'; // never cache the host-patched HTML
  }

  return { status: result.status, headers, body: m === 'HEAD' ? null : body };
}

export interface SandboxServer {
  /** Bare origin, e.g. http://127.0.0.1:54123 — pass to createHost as sandboxOrigin. */
  origin: string;
  port: number;
  /** Full iframe src for the shell entry (carries lc_parent_origin when known). */
  indexUrl: string;
  close: () => Promise<void>;
}

export interface StartSandboxServerOptions {
  bundleRoot: string;
  /** Space renderer origin (the parent frame). Dev: http://localhost:5173. '' if none. */
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
  // Refuse to ever bind a non-loopback interface.
  if (!LOOPBACK_HOSTS.has(host) && !host.startsWith('127.')) {
    return Promise.reject(new Error(`sandbox-server: refusing to bind non-loopback host: ${host}`));
  }
  // Fail fast on a malformed parentOrigin rather than silently degrading framing.
  if (opts.parentOrigin && !isBareOrigin(opts.parentOrigin.trim())) {
    return Promise.reject(new Error(`sandbox-server: parentOrigin is not a bare origin: ${opts.parentOrigin}`));
  }
  const server = createServer((req, res) => {
    const route = handleSandboxRoute(
      opts.bundleRoot,
      opts.parentOrigin,
      req.method ?? 'GET',
      new URL(req.url ?? '/', 'http://placeholder').pathname,
    );
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
      const param = opts.parentOrigin ? `?lc_parent_origin=${encodeURIComponent(opts.parentOrigin)}` : '';
      resolvePromise({
        origin,
        port: addr.port,
        indexUrl: `${origin}/index.html${param}`,
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

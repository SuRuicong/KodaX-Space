// Path-traversal-safe static file serving for the LiveCanvas sandbox bundle.
//
// Space embeds LiveCanvas's sandbox renderer (路径 D — 见记忆 livecanvas_artifact_plan):
// the sandbox-shell is a Next.js static export that Space self-hosts on a
// loopback HTTP server (see sandbox-server.ts). This module is the file-system
// half: given a bundle root + a request path, resolve it safely and return the
// bytes + MIME.
//
// Ported (not imported) from LiveCanvas packages/cli/src/static.ts — Space links
// only @livecanvas/sandbox-bridge + canvas-protocol, NOT the CLI package (which
// would drag gateway-core/llm-clients/node:sqlite, the native deps 路径 D avoids).
// Keep this faithful to the upstream contract so behaviour matches a real LC host.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface StaticServeResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer | null;
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function notFound(): StaticServeResult {
  return { status: 404, headers: {}, body: null };
}

function forbidden(): StaticServeResult {
  return { status: 403, headers: {}, body: null };
}

/**
 * Resolve `relPath` (URL-decoded, may start with '/') relative to `root`.
 * Returns the absolute on-disk path if it stays inside `root`, or null if it
 * escapes (path-traversal attempt). Lexical only — symlink/junction escapes are
 * caught separately by `realContains` (see serveStaticAsset).
 */
export function safeResolve(root: string, relPath: string): string | null {
  const rootAbs = resolve(root);
  const cleaned = normalize(relPath.replace(/^\/+/, ''));
  const candidate = resolve(rootAbs, cleaned);
  const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  if (candidate !== rootAbs && !candidate.startsWith(rootWithSep)) {
    return null;
  }
  return candidate;
}

/**
 * Defense-in-depth beyond `safeResolve`'s lexical check: resolve symlinks/
 * junctions on BOTH the target and the root, then re-check containment in real
 * path space. A symlink inside the bundle pointing outside (or a junction — the
 * shape link-livecanvas.mjs uses on Windows) would pass the lexical check but
 * escape on read. Returns the canonical target path if contained, else null.
 *
 * NOTE: this hardens beyond LiveCanvas's upstream cli/src/static.ts, which omits
 * the realpath step (a latent symlink-escape there too — candidate livecanvas_gap).
 */
export function realContains(rootAbs: string, abs: string): string | null {
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = realpathSync(abs);
    realRoot = realpathSync(rootAbs);
  } catch {
    return null;
  }
  const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(realRootWithSep)) {
    return null;
  }
  return realTarget;
}

/**
 * Serve a file from `root`. `relPath` is the requested path (already stripped
 * of any mount prefix). Returns 200 with the file body, 403 on traversal
 * attempt, or 404 if the file does not exist. Directory requests fall back to
 * `<dir>/index.html` if present.
 */
export function serveStaticAsset(root: string, relPath: string): StaticServeResult {
  if (!existsSync(root)) return notFound();
  const decoded = (() => {
    try {
      return decodeURIComponent(relPath);
    } catch {
      return null;
    }
  })();
  if (decoded === null) return forbidden();
  if (decoded.includes('\0')) return forbidden();

  const abs = safeResolve(root, decoded);
  if (abs === null) return forbidden();

  if (!existsSync(abs)) return notFound();
  const rootAbs = resolve(root);

  // Real-path containment (symlink/junction escape guard).
  let target = realContains(rootAbs, abs);
  if (target === null) return forbidden();
  let stat = statSync(target);
  if (stat.isDirectory()) {
    const indexHtml = join(target, 'index.html');
    if (!existsSync(indexHtml)) return notFound();
    // The index fallback itself could be a symlink — re-check containment.
    const realIndex = realContains(rootAbs, indexHtml);
    if (realIndex === null) return forbidden();
    target = realIndex;
    stat = statSync(target);
  }
  if (!stat.isFile()) return notFound();

  const body = readFileSync(target);
  const ext = extname(target).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
    body,
  };
}

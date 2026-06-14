// Locate the LiveCanvas sandbox-shell static bundle on disk.
//
// The bundle (a Next.js static export: index.html + _next/ + index.txt) is NOT
// an npm package Space depends on — it's a static asset produced by LC's
// `build:bundle`. 路径 D (见记忆 livecanvas_artifact_plan) has Space self-host it
// from a loopback server (sandbox-server.ts). This module decides WHERE that
// bundle lives, in priority order, and validates it is mountable (has index.html).
//
// Resolution order:
//   1. SPACE_LC_SANDBOX_BUNDLE env override (absolute path) — explicit/dev/CI seam.
//   2. Space-local bundled copy — for the packaged app (future: copied into
//      resources at build time, or the published @kodax-ai/livecanvas-sandbox-shell
//      package per LC integration Q3). Candidates are passed in by the caller.
//   3. The sibling LiveCanvas repo's `cli/dist/sandbox-shell-static` — dev only,
//      mirrors how scripts/link-livecanvas.mjs reaches the LC repo.
//
// Kept pure / dependency-injected: callers pass the candidate dirs so this is
// unit-testable against fixtures without touching the real filesystem layout.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface BundleResolution {
  /** Absolute path to the bundle root (the dir containing index.html). */
  root: string;
  /** Which candidate matched — for diagnostics/logging. */
  source: 'env' | 'local' | 'lc-repo';
}

export interface ResolveBundleOptions {
  /** Value of SPACE_LC_SANDBOX_BUNDLE (process.env), if set. */
  envOverride?: string | undefined;
  /** Space-local candidate roots (packaged copy / published package), in order. */
  localCandidates?: readonly string[];
  /** Sibling LC-repo candidate roots (dev), in order. */
  lcRepoCandidates?: readonly string[];
}

/** A bundle root is mountable only if it exists and contains index.html. */
export function isMountableBundle(root: string): boolean {
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return false;
    return existsSync(join(root, 'index.html'));
  } catch {
    return false;
  }
}

/**
 * Resolve the first mountable bundle root, or an error describing what was tried.
 * Never throws — returns a discriminated result the caller can log/branch on.
 */
export function resolveSandboxBundle(
  opts: ResolveBundleOptions = {},
): { ok: true; resolution: BundleResolution } | { ok: false; tried: string[]; reason: string } {
  const tried: string[] = [];

  const consider = (
    candidate: string | undefined,
    source: BundleResolution['source'],
  ): BundleResolution | null => {
    if (!candidate) return null;
    const abs = resolve(candidate);
    tried.push(`${source}:${abs}`);
    return isMountableBundle(abs) ? { root: abs, source } : null;
  };

  // The env override is a static-serve ROOT — require an absolute path so it
  // can't be a cwd-relative value that points somewhere unexpected.
  const envOverride =
    opts.envOverride && isAbsolute(opts.envOverride) ? opts.envOverride : undefined;

  const found =
    consider(envOverride, 'env') ??
    firstMatch(opts.localCandidates, 'local', consider) ??
    firstMatch(opts.lcRepoCandidates, 'lc-repo', consider);

  if (found) return { ok: true, resolution: found };
  return {
    ok: false,
    tried,
    reason:
      tried.length === 0
        ? 'no bundle candidates provided'
        : 'no candidate contained a mountable sandbox bundle (index.html missing). ' +
          'Run `npm run -w @kodax-ai/livecanvas build:bundle` in the LiveCanvas repo, ' +
          'or set SPACE_LC_SANDBOX_BUNDLE to a built bundle dir.',
  };
}

function firstMatch(
  candidates: readonly string[] | undefined,
  source: BundleResolution['source'],
  consider: (c: string | undefined, s: BundleResolution['source']) => BundleResolution | null,
): BundleResolution | null {
  for (const c of candidates ?? []) {
    const hit = consider(c, source);
    if (hit) return hit;
  }
  return null;
}

/**
 * Default candidate dirs for the running app, derived from the Space repo root.
 * `spaceRepoRoot` = the monorepo root (the dir containing apps/ packages/ …); at
 * runtime main passes `path.resolve(__dirname, '..')` where __dirname is the
 * compiled main dir (dist-electron). The LC repo sits two levels above it,
 * matching scripts/link-livecanvas.mjs's `resolve(SPACE_ROOT, '..', '..', 'LiveCanvas')`.
 */
export function defaultBundleCandidates(spaceRepoRoot: string): {
  local: string[];
  lcRepo: string[];
} {
  return {
    // Packaged copy lands under the app resources; placeholder until F-? wires
    // the copy step / published package. Harmless if absent.
    local: [join(spaceRepoRoot, 'resources', 'sandbox-shell-static')],
    lcRepo: [
      resolve(spaceRepoRoot, '..', '..', 'LiveCanvas', 'packages', 'cli', 'dist', 'sandbox-shell-static'),
    ],
  };
}

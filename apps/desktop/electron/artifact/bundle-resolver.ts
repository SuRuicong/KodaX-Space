// Decide WHERE the LiveCanvas sandbox bundle lives and validate it is mountable.
//
// 路径 D (记忆 livecanvas_artifact_plan): the bundle is the standalone package
// @kodax-ai/livecanvas-sandbox-shell — its getStaticDir() returns the static
// export dir (index.html + _next/ + ...). Space self-hosts it from a loopback
// server (sandbox-server.ts). sandbox-host.ts passes that dir in as a candidate;
// this module just picks the first mountable root and reports a clear error.
//
// Resolution order:
//   1. SPACE_LC_SANDBOX_BUNDLE env override (absolute path) — explicit/dev/CI seam.
//   2. package candidate(s) — getStaticDir() from @kodax-ai/livecanvas-sandbox-shell
//      (or a test-injected list).
//
// Kept pure / dependency-injected so it unit-tests against fixtures.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface BundleResolution {
  /** Absolute path to the bundle root (the dir containing index.html). */
  root: string;
  /** Which candidate matched — for diagnostics/logging. */
  source: 'env' | 'package';
}

export interface ResolveBundleOptions {
  /** Value of SPACE_LC_SANDBOX_BUNDLE (process.env), if set. Must be absolute to be used. */
  envOverride?: string | undefined;
  /** Candidate roots from the standalone package's getStaticDir() (or a test seam). */
  packageCandidates?: readonly string[];
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

  let found = consider(envOverride, 'env');
  if (!found) {
    for (const c of opts.packageCandidates ?? []) {
      found = consider(c, 'package');
      if (found) break;
    }
  }

  if (found) return { ok: true, resolution: found };
  return {
    ok: false,
    tried,
    reason:
      tried.length === 0
        ? 'no bundle candidates provided'
        : 'no candidate contained a mountable sandbox bundle (index.html missing). ' +
          'Ensure @kodax-ai/livecanvas-sandbox-shell is installed/linked (npm run link:livecanvas), ' +
          'or set SPACE_LC_SANDBOX_BUNDLE to a built bundle dir.',
  };
}

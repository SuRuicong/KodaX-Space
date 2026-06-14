// Process-global owner of the loopback sandbox server (路径 D — 记忆 livecanvas_artifact_plan).
//
// Mirrors the ptyHost / kodaxHost singleton pattern: one instance per main
// process, started once on app ready, disposed on quit. Best-effort — if the
// LiveCanvas sandbox bundle (@kodax-ai/livecanvas-sandbox-shell) is not
// linked/installed, start() records a not-ready info with a diagnostic and opens
// no port; the renderer shows a placeholder.

import { createRequire } from 'node:module';
import { startSandboxServer, type SandboxServer } from './sandbox-server.js';
import { resolveSandboxBundle } from './bundle-resolver.js';

interface ShellPackage {
  getStaticDir: () => string;
  version: string;
}

/**
 * Lazily load the standalone bundle package. Guarded + lazy on purpose: only the
 * production start path (no test seam) calls it, so the package — whose dist does
 * createRequire('../package.json') and trips the tsx/esm test loader — is never
 * evaluated under `node --test`. createRequire dual-track mirrors register.ts
 * (CJS main build uses `require`; esm uses createRequire(import.meta.url)).
 */
function loadShellPackage(): ShellPackage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = typeof require !== 'undefined' ? null : (import.meta as any);
    const req = meta ? createRequire(meta.url) : require;
    return req('@kodax-ai/livecanvas-sandbox-shell') as ShellPackage;
  } catch {
    return null;
  }
}

export interface SandboxInfo {
  ready: boolean;
  sandboxOrigin?: string;
  indexUrl?: string;
  /** Shell bundle version (for protocol-compat assertion against sandbox-bridge). */
  shellVersion?: string;
  error?: string;
}

export interface StartSandboxHostOptions {
  /** The Space renderer origin (parent frame). Dev: http://localhost:5173. '' if none yet. */
  parentOrigin: string;
  /** SPACE_LC_SANDBOX_BUNDLE override (process.env), if set. */
  envOverride?: string | undefined;
  /**
   * Test seam: explicit bundle candidate roots. When provided, the standalone
   * package's getStaticDir() is NOT consulted (so tests stay hermetic even when
   * the real package is linked).
   */
  bundleCandidates?: readonly string[];
}

class SandboxHost {
  private server: SandboxServer | null = null;
  private info: SandboxInfo = { ready: false, error: 'sandbox server not started' };
  private starting: Promise<SandboxInfo> | null = null;

  /**
   * Idempotent + concurrency-safe: a second call after start returns the cached
   * info; a second call WHILE the first is still awaiting coalesces onto the same
   * in-flight promise (so we never open two servers and leak the first's port).
   */
  async start(opts: StartSandboxHostOptions): Promise<SandboxInfo> {
    if (this.server) return this.info;
    if (this.starting) return this.starting;
    // doStart sets this.server synchronously BEFORE its promise resolves, so by
    // the time .finally clears `starting`, a subsequent call already sees
    // this.server (success) or a clean null/null state to retry (failure). No
    // window exists where two doStart runs open two servers.
    this.starting = this.doStart(opts).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(opts: StartSandboxHostOptions): Promise<SandboxInfo> {
    // Test seam: explicit candidates skip the real package (hermetic tests).
    let packageCandidates: readonly string[];
    let shellVersion: string | undefined;
    if (opts.bundleCandidates) {
      packageCandidates = opts.bundleCandidates;
    } else {
      const pkg = loadShellPackage();
      packageCandidates = pkg ? [pkg.getStaticDir()] : [];
      shellVersion = pkg?.version;
    }

    const resolved = resolveSandboxBundle({
      envOverride: opts.envOverride,
      packageCandidates,
    });
    if (!resolved.ok) {
      this.info = { ready: false, error: resolved.reason };
      return this.info;
    }

    try {
      this.server = await startSandboxServer({
        bundleRoot: resolved.resolution.root,
        parentOrigin: opts.parentOrigin,
      });
      this.info = {
        ready: true,
        sandboxOrigin: this.server.origin,
        indexUrl: this.server.indexUrl,
        shellVersion,
      };
    } catch (err) {
      this.info = { ready: false, error: err instanceof Error ? err.message : String(err) };
    }
    return this.info;
  }

  getInfo(): SandboxInfo {
    return this.info;
  }

  async dispose(): Promise<void> {
    const srv = this.server;
    this.server = null;
    this.info = { ready: false, error: 'sandbox server disposed' };
    if (srv) await srv.close();
  }
}

export const sandboxHost = new SandboxHost();

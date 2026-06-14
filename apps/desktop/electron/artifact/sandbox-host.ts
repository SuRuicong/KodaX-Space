// Process-global owner of the loopback sandbox server (路径 D — 记忆 livecanvas_artifact_plan).
//
// Mirrors the ptyHost / kodaxHost singleton pattern: one instance per main
// process, started once on app ready, disposed on quit. Best-effort — if the
// LiveCanvas sandbox bundle is not installed (current reality until LC ships a
// working build:bundle / the sandbox-shell package), start() records a not-ready
// info with a diagnostic and opens no port; the renderer shows a placeholder.

import { startSandboxServer, type SandboxServer } from './sandbox-server.js';
import { resolveSandboxBundle, defaultBundleCandidates } from './bundle-resolver.js';

export interface SandboxInfo {
  ready: boolean;
  sandboxOrigin?: string;
  indexUrl?: string;
  error?: string;
}

export interface StartSandboxHostOptions {
  /** Absolute path to the Space repo root (used to derive bundle candidate dirs). */
  spaceRepoRoot: string;
  /** The Space renderer origin (parent frame). Dev: http://localhost:5173. '' if none yet. */
  parentOrigin: string;
  /** SPACE_LC_SANDBOX_BUNDLE override (process.env), if set. */
  envOverride?: string | undefined;
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
    this.starting = this.doStart(opts).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(opts: StartSandboxHostOptions): Promise<SandboxInfo> {
    const candidates = defaultBundleCandidates(opts.spaceRepoRoot);
    const resolved = resolveSandboxBundle({
      envOverride: opts.envOverride,
      localCandidates: candidates.local,
      lcRepoCandidates: candidates.lcRepo,
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

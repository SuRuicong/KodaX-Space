// Artifact channels — 路径 D (LiveCanvas sandbox embed; 见记忆 livecanvas_artifact_plan).
//
// P1: `artifact.sandboxInfo` lets the renderer learn where the self-hosted
// sandbox bundle is served (the loopback server in electron/artifact/) so its
// ArtifactPanel <iframe> can point at it and run the sandbox-bridge handshake.
//
// Returns ready:false (+ a human-readable `error`) when the bundle is not
// installed — currently the case until LiveCanvas ships a working
// `build:bundle` / the @kodax-ai/livecanvas-sandbox-shell package (见记忆
// livecanvas_gap_sandbox_bundle). The renderer renders a placeholder in that
// case rather than a broken iframe.
//
// Later phases (P2+) add artifact.create/list/read/export on top.

import { z } from 'zod';

// ---- Invoke: artifact.sandboxInfo ----
export const artifactSandboxInfoChannel = {
  name: 'artifact.sandboxInfo',
  direction: 'invoke',
  input: z.undefined().optional(),
  output: z.object({
    /** True only when the loopback sandbox server is up and a mountable bundle was found. */
    ready: z.boolean(),
    /** Bare origin of the sandbox server, e.g. http://127.0.0.1:54123. Present iff ready. */
    sandboxOrigin: z.string().url().optional(),
    /** Full iframe src for the sandbox-shell entry (carries lc_parent_origin). Present iff ready. */
    indexUrl: z.string().url().optional(),
    /** Shell bundle version — for asserting protocol compat against sandbox-bridge. */
    shellVersion: z.string().max(64).optional(),
    /** Diagnostic message when not ready (e.g. bundle missing). Never present when ready. */
    error: z.string().max(2048).optional(),
  }),
} as const;

export type ArtifactSandboxInfo = z.infer<typeof artifactSandboxInfoChannel.output>;

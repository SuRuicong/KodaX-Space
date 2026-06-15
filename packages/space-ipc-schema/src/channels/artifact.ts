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

// ============================================================================
// F057 — Artifact data layer (LC-free; static tier). Space owns/persists artifacts
// under ~/.kodax/space/artifacts/. Content is fetched per-version via artifact.read
// so list() stays a light metadata payload.
// ============================================================================

export const artifactKindSchema = z.enum([
  'markdown',
  'code',
  'html',
  'svg',
  'image',
  'pdf',
  'docx',
  'xlsx',
  'chart',
  'react',
]);
export type ArtifactKindT = z.infer<typeof artifactKindSchema>;

const artifactSurfaceSchema = z.enum(['code', 'partner']);

/** Max inline content per version (text/code/html/svg/chart-json/react/image-data-uri). */
export const MAX_ARTIFACT_CONTENT_BYTES = 1_048_576; // 1 MB (UTF-8 bytes)
export const ARTIFACT_MAX_VERSIONS = 100;

// UTF-8 byte length (portable: TextEncoder exists in node + browser).
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

// Content cap as UTF-8 BYTES (consistent with the store). `.max()` is a cheap
// char pre-filter (chars ≤ bytes, so it never wrongly rejects in-budget content)
// before the exact byte refine.
const artifactContentSchema = z
  .string()
  .max(MAX_ARTIFACT_CONTENT_BYTES)
  .refine((s) => utf8Bytes(s) <= MAX_ARTIFACT_CONTENT_BYTES, { message: 'content exceeds size limit' });

// Reject NUL/CR/LF in path references (defense-in-depth; actual file reads are
// scope-gated downstream by files.readBinary). Char-code check, not a regex
// literal, to keep this source pure ASCII.
function hasPathControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || c === 13 || c === 10) return true;
  }
  return false;
}
const artifactPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !hasPathControlChar(s), { message: 'path contains control characters' });

const DOC_KINDS = ['pdf', 'docx', 'xlsx'] as const;

/** Per-version metadata returned by list/read — never carries the heavy content. */
const artifactVersionMetaSchema = z.object({
  v: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  /** True for content-backed kinds (content fetched via artifact.read). */
  hasContent: z.boolean(),
  /** File reference for doc kinds (pdf/docx/xlsx); the file lives on disk in scope. */
  path: z.string().max(4096).optional(),
  summary: z.string().max(512).optional(),
});

/** Artifact metadata (no content) — the list/store-facing shape. */
export const artifactRefSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  surface: artifactSurfaceSchema,
  kind: artifactKindSchema,
  title: z.string().min(1).max(256),
  currentVersion: z.number().int().positive(),
  versions: z.array(artifactVersionMetaSchema).min(1).max(ARTIFACT_MAX_VERSIONS),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ArtifactRefT = z.infer<typeof artifactRefSchema>;

// ---- Invoke: artifact.create (new artifact OR append a version when `id` matches) ----
export const artifactCreateChannel = {
  name: 'artifact.create',
  direction: 'invoke',
  input: z
    .object({
      sessionId: z.string().min(1).max(128),
      surface: artifactSurfaceSchema,
      kind: artifactKindSchema,
      title: z.string().min(1).max(256),
      /** Inline content for content-backed kinds (chart = JSON string of the spec). */
      content: artifactContentSchema.optional(),
      /** File reference for doc kinds. */
      path: artifactPathSchema.optional(),
      summary: z.string().max(512).optional(),
      /** When set and existing, appends a new version (iterate) instead of creating new. */
      id: z.string().min(1).max(128).optional(),
    })
    .superRefine((val, ctx) => {
      // kind ↔ payload coherence: doc kinds need a path; everything else needs content.
      const isDoc = (DOC_KINDS as readonly string[]).includes(val.kind);
      if (isDoc && val.path === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'doc kinds require a path', path: ['path'] });
      }
      if (!isDoc && val.content === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'this kind requires content', path: ['content'] });
      }
    }),
  output: z.object({
    id: z.string().min(1),
    version: z.number().int().positive(),
  }),
} as const;

// ---- Invoke: artifact.list ----
export const artifactListChannel = {
  name: 'artifact.list',
  direction: 'invoke',
  input: z
    .object({
      sessionId: z.string().min(1).max(128).optional(),
      surface: artifactSurfaceSchema.optional(),
    })
    .optional(),
  output: z.object({ artifacts: z.array(artifactRefSchema) }),
} as const;

// ---- Invoke: artifact.read (resolve one version's content) ----
export const artifactReadChannel = {
  name: 'artifact.read',
  direction: 'invoke',
  input: z.object({
    id: z.string().min(1).max(128),
    /** Defaults to currentVersion when omitted. */
    version: z.number().int().positive().optional(),
  }),
  output: z.object({
    ref: artifactRefSchema,
    version: z.number().int().positive(),
    content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES).optional(),
    path: z.string().max(4096).optional(),
  }),
} as const;

// ---- Invoke: artifact.delete ----
export const artifactDeleteChannel = {
  name: 'artifact.delete',
  direction: 'invoke',
  input: z.object({ id: z.string().min(1).max(128) }),
  output: z.object({ deleted: z.boolean() }),
} as const;

// ---- Push: artifact.changed (store mutated → renderer refetches) ----
export const artifactChangedChannel = {
  name: 'artifact.changed',
  direction: 'push',
  payload: z.object({
    /** The artifact that changed, or undefined for bulk/delete (renderer refetches list). */
    id: z.string().min(1).max(128).optional(),
    reason: z.enum(['created', 'version', 'deleted']),
  }),
} as const;

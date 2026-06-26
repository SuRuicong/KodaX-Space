// Artifact channels — F057 data layer (记忆 livecanvas_artifact_plan).
//
// The LC sandbox `artifact.sandboxInfo` channel (路径 D loopback server) was
// removed along with the LiveCanvas interactive tier; it re-lands as a separate
// feature once LiveCanvas stabilizes. What remains is the LC-free artifact store.

import { z } from 'zod';

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
  .refine((s) => utf8Bytes(s) <= MAX_ARTIFACT_CONTENT_BYTES, {
    message: 'content exceeds size limit',
  });

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
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'doc kinds require a path',
          path: ['path'],
        });
      }
      if (isDoc && val.content !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'doc kinds do not accept inline content',
          path: ['content'],
        });
      }
      if (!isDoc && val.content === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'this kind requires content',
          path: ['content'],
        });
      }
      if (!isDoc && val.path !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'content kinds do not accept a path',
          path: ['path'],
        });
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

// ---- Invoke: artifact.export (save a version's content to a user-chosen file) ----
// Content-backed kinds only (markdown/code/html/svg/chart/image). Doc kinds
// (pdf/docx/xlsx) are already files on disk — exporting them would mean copying an
// arbitrary stored path (file-exfil vector), so they're not exportable here.
export const artifactExportChannel = {
  name: 'artifact.export',
  direction: 'invoke',
  input: z.object({
    id: z.string().min(1).max(128),
    version: z.number().int().positive().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    /** Written file path (present when ok). */
    path: z.string().max(4096).optional(),
    /** True when the user cancelled the save dialog. */
    canceled: z.boolean().optional(),
    /** Diagnostic when ok=false and not cancelled. */
    error: z.string().max(512).optional(),
  }),
} as const;

// ---- Invoke: artifact.openWindow (F059c — open one artifact in a separate maximized window) ----
// L3 of the artifact view escalation (sidebar tab → full-cover popout → standalone window).
// The child window loads the renderer with a `#artifact?...` hash and renders ArtifactWindow,
// which reads the artifact by id over IPC (no shared store with the main window).
export const artifactOpenWindowChannel = {
  name: 'artifact.openWindow',
  direction: 'invoke',
  input: z.object({
    id: z.string().min(1).max(128),
    /** Defaults to currentVersion when omitted. */
    version: z.number().int().positive().optional(),
    /** Needed by doc kinds (pdf/docx/xlsx) to resolve the on-disk path; ignored otherwise. */
    projectRoot: z.string().max(4096).optional(),
    /** OS window title (cosmetic). */
    title: z.string().max(256).optional(),
  }),
  output: z.object({ ok: z.boolean() }),
} as const;

// ---- Invoke: artifact.previewFile (2026-06-18 — "一键预览"已写盘的文件) ----
//
// 背景：AI 用 write 工具往项目里写了个 .html / .svg / .md，**不会**自动进 Artifact 面板
// （write 工具与 ArtifactStore 无桥）。用户反馈"写完网页不在 Artifact 显示、联动不足"。
// 这个 channel 让 renderer 把"一个已在磁盘上的可预览文件"一键灌进 Artifact 面板：
//   main 端读盘（projectRoot 子树内、防穿越）→ 按扩展名定 kind（html/svg/markdown/code）
//   → upsert 进 store（同一 (sessionId,title) 复用 id 升版本，重复预览不刷出一堆副本）
//   → push artifact.changed → 面板渲染 sandbox iframe 预览。
//
// 与 create_artifact 的区别：create_artifact 是 AI 主动把"生成内容"作为 deliverable；
// previewFile 是用户/UI 把"已落盘文件"提级为可预览产物，content 来自磁盘而非入参。
//
// 安全：path 走与 files.read 相同的 projectRoot 子树校验（resolveInsideProject）；
// 二进制文件拒（isBinary→抛错，renderer 回退到"在文件管理器中显示"）；
// 超 1MB 内容拒（artifactStore upsert 上限），renderer 回退同理。
export const artifactPreviewFileChannel = {
  name: 'artifact.previewFile',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1).max(128),
    surface: artifactSurfaceSchema,
    projectRoot: artifactPathSchema,
    /** 相对 projectRoot 的 posix-style 路径（renderer 端已归一化）。 */
    path: artifactPathSchema,
  }),
  output: z.object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    kind: artifactKindSchema,
  }),
} as const;

// ---- Push: artifact.changed (store mutated → renderer refetches) ----
export const artifactChangedChannel = {
  name: 'artifact.changed',
  direction: 'push',
  payload: z.object({
    /** The artifact that changed, or undefined for bulk/delete (renderer refetches list). */
    id: z.string().min(1).max(128).optional(),
    /** Owning session — lets a renderer skip refetches for other sessions. Absent on delete. */
    sessionId: z.string().min(1).max(128).optional(),
    reason: z.enum(['created', 'version', 'deleted']),
  }),
} as const;

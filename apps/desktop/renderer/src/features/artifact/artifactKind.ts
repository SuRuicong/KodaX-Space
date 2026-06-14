// Artifact kind taxonomy + tier gating (F056).
//
// Two tiers:
//   - STATIC tier (LC-free, the release baseline): rendered entirely with Space's
//     own/already-shipping capability (react-markdown, Monaco, F024 RichPreview)
//     plus the new Html + Chart renderers. NO @livecanvas/* dependency.
//   - INTERACTIVE REACT tier ('react'): runs arbitrary AI React in the LiveCanvas
//     sandbox (路径 D). LC is a 半成品 → this tier is GATED OFF for release so it
//     never blocks Space's ship date; it re-enables once LC GAs (npm + F055 app://).

export type ArtifactKind =
  | 'markdown'
  | 'code'
  | 'html'
  | 'svg'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'chart'
  | 'react';

/** Kinds renderable without LiveCanvas — the shippable baseline. */
export const STATIC_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'markdown',
  'code',
  'html',
  'svg',
  'image',
  'pdf',
  'docx',
  'xlsx',
  'chart',
];

/**
 * Whether the interactive-React tier (LiveCanvas sandbox) is enabled.
 *
 * Release posture (decided 2026-06-15): OFF for shipped builds — only dev, where
 * we keep iterating the LC tier. A future SPACE_ENABLE_REACT_ARTIFACT opt-in can
 * flip this on once LC is GA. Everything user-facing in production stays on the
 * static tier, so the LC half-product can never gate the release.
 */
export function isReactArtifactEnabled(): boolean {
  return import.meta.env.DEV;
}

/** Whether a kind is in the static (LC-free) baseline. */
export function isStaticArtifactKind(kind: ArtifactKind): boolean {
  return STATIC_ARTIFACT_KINDS.includes(kind);
}

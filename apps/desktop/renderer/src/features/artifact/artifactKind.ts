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
 * Two-layer gate (decided 2026-06-15):
 *
 * 1) HARD RELEASE GATE — `import.meta.env.DEV` is false in any packaged/release
 *    build; Vite folds it to a constant and tree-shakes this whole branch out.
 *    Nothing below can turn the LC tier on in a shipped build, so **发布永不受影响**,
 *    no matter how the toggle is set.
 *
 * 2) DEV ON-DEMAND TOGGLE — within dev it defaults OFF (the half-baked LC tier
 *    stays hidden until you actively test it). Turn it on/off either way:
 *      • whole dev session: launch with  `VITE_LC_REACT_ARTIFACT=1 npm run dev`
 *      • ad-hoc, no restart: in DevTools run
 *          localStorage.setItem('lc.reactArtifact','1')   // 打开，刷新生效
 *          localStorage.removeItem('lc.reactArtifact')     // 关掉，刷新生效
 *
 * So you can flip it on to help debug LC and flip it off when done, while release
 * builds are structurally unaffected.
 */
export function isReactArtifactEnabled(): boolean {
  if (!import.meta.env.DEV) return false; // hard release gate — tree-shaken in prod
  const env = import.meta.env as unknown as { VITE_LC_REACT_ARTIFACT?: string };
  if (env.VITE_LC_REACT_ARTIFACT === '1') return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('lc.reactArtifact') === '1';
  } catch {
    return false;
  }
}

/** Whether a kind is in the static (LC-free) baseline. */
export function isStaticArtifactKind(kind: ArtifactKind): boolean {
  return STATIC_ARTIFACT_KINDS.includes(kind);
}

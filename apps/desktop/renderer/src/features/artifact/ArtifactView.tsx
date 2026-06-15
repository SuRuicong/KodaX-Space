// ArtifactView (F056) — the artifact renderer registry: dispatch a typed artifact
// to its renderer by `kind`.
//
// STATIC tier (LC-free, release baseline): markdown/code/html/svg/image/chart +
// pdf/docx/xlsx (reusing F024 RichPreview). INTERACTIVE tier ('react') runs in the
// LiveCanvas sandbox and is GATED by isReactArtifactEnabled() — OFF in shipped
// builds, so the LC half-product never blocks release.

import { lazy, Suspense } from 'react';
import { Markdown } from '../session/messages/Markdown';
import { MonacoViewer } from '../code/MonacoViewer';
import { RichPreview } from '../preview/RichPreview';
import { isReactArtifactEnabled } from './artifactKind';
import { HtmlArtifact } from './renderers/HtmlArtifact';
import { ChartArtifact } from './renderers/ChartArtifact';
import { SvgArtifact, ImageArtifact } from './renderers/MediaArtifact';

// The interactive-React tier (LiveCanvas sandbox) loads via a dynamic import
// GUARDED by the static `import.meta.env.DEV` constant. In a release build Vite
// folds DEV to false, so Rollup dead-code-eliminates this branch — the
// SandboxFrame chunk AND its `@livecanvas/sandbox-bridge` dependency never enter
// the bundle. **发布构建因此完全不编译/不依赖 LC**;dev 才按需加载(artifactKind 门控)。
const SandboxFrameLazy = import.meta.env.DEV
  ? lazy(() => import('./SandboxFrame').then((m) => ({ default: m.SandboxFrame })))
  : null;

export type { ArtifactContent } from './artifactContent';
import type { ArtifactContent } from './artifactContent';

function ReactTierUnavailable(): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center leading-relaxed">
      交互式预览暂未启用。
    </div>
  );
}

function Unsupported({ what }: { what: string }): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-[11px] text-fg-muted text-center leading-relaxed">
      无法渲染该产物（{what}）。
    </div>
  );
}

/**
 * Defense-in-depth on image src (content is AI-generated): allow only data:image/
 * URIs and scheme-less app-relative paths. Blocks javascript:/file:/blob:/http(s):
 * etc. (renderer CSP img-src 'self' data: already blocks most, but don't rely on
 * CSP alone in case it's relaxed later).
 */
function isSafeImageSrc(src: string): boolean {
  return src.startsWith('data:image/') || /^[^:]*$/.test(src);
}

export function ArtifactView(props: ArtifactContent): JSX.Element {
  switch (props.kind) {
    case 'markdown':
      return (
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <Markdown content={props.content} />
        </div>
      );
    case 'code':
      return (
        <div className="flex-1 min-h-0">
          <MonacoViewer path={props.filename ?? 'artifact.txt'} content={props.content} />
        </div>
      );
    case 'html':
      return <HtmlArtifact html={props.content} />;
    case 'svg':
      return <SvgArtifact svg={props.content} />;
    case 'image':
      if (!isSafeImageSrc(props.src)) return <Unsupported what="image" />;
      return <ImageArtifact src={props.src} alt={props.alt} />;
    case 'chart':
      return <ChartArtifact spec={props.spec} />;
    case 'pdf':
    case 'docx':
    case 'xlsx':
      return (
        <div className="flex-1 min-h-0">
          <RichPreview projectRoot={props.projectRoot} path={props.path} kind={props.kind} />
        </div>
      );
    case 'react':
      if (!isReactArtifactEnabled() || !SandboxFrameLazy) return <ReactTierUnavailable />;
      return (
        <Suspense fallback={<div className="flex-1" />}>
          <SandboxFrameLazy
            indexUrl={props.indexUrl}
            sandboxOrigin={props.sandboxOrigin}
            code={props.code}
            artifactId={props.artifactId}
          />
        </Suspense>
      );
    default: {
      // Exhaustiveness guard: adding an ArtifactContent variant without a branch
      // fails to compile here instead of silently rendering nothing.
      const _exhaustive: never = props;
      void _exhaustive;
      return <Unsupported what="unknown" />;
    }
  }
}

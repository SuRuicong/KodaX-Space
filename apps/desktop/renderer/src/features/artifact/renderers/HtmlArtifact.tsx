// HtmlArtifact (F056, static tier) — render AI-produced static HTML safely.
//
// `sandbox=""` (empty allow-list) is the whole safety story: it disables scripts,
// forms, popups, top-navigation, and same-origin access. So even if the HTML
// carries a <script> or inline handlers, nothing executes — it renders as inert
// static markup. No JS eval, no LiveCanvas, no dompurify needed (the sandbox is
// the boundary). Verified by e2e/artifact-static-render.mjs.

export interface HtmlArtifactProps {
  html: string;
}

export function HtmlArtifact({ html }: HtmlArtifactProps): JSX.Element {
  return (
    <iframe
      title="HTML artifact"
      srcDoc={html}
      sandbox=""
      className="w-full h-full flex-1 border-0 bg-white"
    />
  );
}

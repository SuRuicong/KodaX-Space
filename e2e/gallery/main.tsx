// Gallery entry: render the Space static artifact renderers with sample data so
// the e2e (artifact-renderers.mjs) can assert each produces real DOM in a browser.
// Imports the actual renderer components from the app source (no copies).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/ChartArtifact';
import { HtmlArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/HtmlArtifact';
import { SvgArtifact, ImageArtifact } from '../../apps/desktop/renderer/src/features/artifact/renderers/MediaArtifact';
// markdown artifact path: ArtifactView renders <Markdown content/> in a div, so
// testing the Markdown component directly faithfully covers it.
import { Markdown } from '../../apps/desktop/renderer/src/features/session/messages/Markdown';

const MARKDOWN = '# Gallery MD\n\nSome **bold** text.\n\n- one\n- two\n\n```js\nconst x = 1;\n```';

const chartSpec = {
  type: 'line',
  xKey: 'name',
  title: 'Gallery chart',
  data: [
    { name: 'Mon', v: 12 },
    { name: 'Tue', v: 19 },
    { name: 'Wed', v: 7 },
  ],
  series: [{ key: 'v', label: 'Visits' }],
};

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#f59e0b"/></svg>';

function App(): JSX.Element {
  return (
    <div>
      <div data-testid="chart" style={{ width: 460, height: 300, display: 'flex' }}>
        <ChartArtifact spec={chartSpec} />
      </div>
      <div data-testid="chart-bad" style={{ width: 460, height: 120, display: 'flex' }}>
        <ChartArtifact spec={{ type: 'pie', nope: true }} />
      </div>
      <div data-testid="html" style={{ width: 460, height: 160, display: 'flex' }}>
        <HtmlArtifact html={'<h1 id="hdr">Hello HTML</h1><p>static body</p>'} />
      </div>
      <div data-testid="svg" style={{ width: 200, height: 200, display: 'flex' }}>
        <SvgArtifact svg={svg} />
      </div>
      <div data-testid="image" style={{ width: 200, height: 200, display: 'flex' }}>
        <ImageArtifact src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      </div>
      <div data-testid="markdown" style={{ width: 460 }}>
        <Markdown content={MARKDOWN} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

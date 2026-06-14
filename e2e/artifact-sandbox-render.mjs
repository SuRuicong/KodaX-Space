// E2E (F048 P1c): artifact 路径 D 渲染冒烟 —— 真 bundle + 真握手 + 真 react-runner。
//
// 在真实浏览器里验证整条嵌入链(不依赖 Electron,故能完整自动化):
//   1. serve @kodax-ai/livecanvas-sandbox-shell 的真 static bundle(根服务 + 注入 trusted origins)。
//   2. 父页面(stand-in renderer)嵌 iframe → sandbox,走 sandbox-bridge 同款 raw postMessage 握手
//      (收 lc:ready → 发 lc:artifact {code,bootstrap}),注入 recharts 测试 artifact。
//   3. Playwright 断言 iframe 内 react-runner 真渲染出 recharts 的 <svg class="recharts-surface">。
//
// 覆盖 LC-shell 边界(渲染/握手/白名单库),是 feedback_mock_fidelity 要求的真验证。
// 注:本测用最小内联静态 server(纯 mjs,避免 tsx 与 playwright 的 package.json require 冲突);
//     Space 真正的 electron/artifact/sandbox-server.ts 由 electron/test/sandbox-server.test.ts 单测。
// 运行: env -u ELECTRON_RUN_AS_NODE node e2e/artifact-sandbox-render.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, normalize, resolve, sep } from 'node:path';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.map': 'application/json',
  '.png': 'image/png', '.wasm': 'application/wasm',
};

function safeJoin(root, rel) {
  const rootAbs = resolve(root);
  const cand = resolve(rootAbs, normalize(rel.replace(/^\/+/, '')));
  const withSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  return cand === rootAbs || cand.startsWith(withSep) ? cand : null;
}

const RECHARTS_CODE = `import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
const data=[{name:'Mon',v:12},{name:'Tue',v:19},{name:'Wed',v:9},{name:'Thu',v:23},{name:'Fri',v:17},{name:'Sat',v:28},{name:'Sun',v:21}]
export default function App(){return (<div style={{width:'100%',height:'100%',minHeight:240,padding:12}}>
<ResponsiveContainer width="100%" height={220}><LineChart data={data}>
<CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis/><Tooltip/>
<Line type="monotone" dataKey="v" stroke="#f59e0b" strokeWidth={2}/></LineChart></ResponsiveContainer></div>)}`;

function injectTrusted(html, origin) {
  const json = JSON.stringify([origin]).replace(/</g, '\\u003c');
  const tag = `<script>window.__LC_TRUSTED_PARENT_ORIGINS__=${json};</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html;
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026');
}

function parentPageHtml(indexUrl, sandboxOrigin) {
  const payload = {
    type: 'lc:artifact',
    code: RECHARTS_CODE,
    bootstrap: {
      artifactId: 'e2e-smoke-recharts',
      scopedToken: 'static-artifact-no-backend-placeholder',
      apiBase: sandboxOrigin,
      sandboxOrigin,
    },
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>render-smoke</title>
<style>html,body{margin:0;height:100%}#shell{width:100vw;height:100vh;border:0}</style></head><body>
<iframe id="shell" src="${indexUrl.replace(/"/g, '&quot;')}"></iframe>
<script>(function(){var f=document.getElementById('shell');var a=${safeJsonForScript(payload)};
var c=${safeJsonForScript(sandboxOrigin)};var sent=false;
window.addEventListener('message',function(ev){if(ev.source!==f.contentWindow)return;if(ev.origin!==c)return;
if(!ev.data||ev.data.type!=='lc:ready')return;if(sent)return;sent=true;f.contentWindow.postMessage(a,c);});})();
</script></body></html>`;
}

function startStatic(root, parentOrigin) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const rel = pathname === '/' ? '/index.html' : pathname;
    const abs = safeJoin(root, rel);
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); res.end(); return; }
    let body = readFileSync(abs);
    const ct = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
    if (rel === '/index.html') body = Buffer.from(injectTrusted(body.toString('utf8'), parentOrigin));
    res.writeHead(200, { 'Content-Type': ct });
    res.end(body);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

async function main() {
  const require_ = createRequire(import.meta.url);
  let staticDir;
  try {
    staticDir = dirname(require_.resolve('@kodax-ai/livecanvas-sandbox-shell/static/index.html'));
  } catch (err) {
    console.error('✗ cannot resolve sandbox-shell static — run `npm run link:livecanvas`');
    throw err;
  }
  ok(true, `real bundle static dir: ${staticDir}`);

  // Parent page server first → its origin is the trusted parent origin.
  let pageHtml = '<!doctype html><title>booting</title>';
  const ps = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(pageHtml); });
  await new Promise((r) => ps.listen(0, '127.0.0.1', r));
  const parentOrigin = `http://127.0.0.1:${ps.address().port}`;

  // Sandbox static server (serves the real bundle at root, injects trust).
  const { server: sandboxServer, port: sbPort } = await startStatic(staticDir, parentOrigin);
  const sandboxOrigin = `http://127.0.0.1:${sbPort}`;
  const indexUrl = `${sandboxOrigin}/index.html?lc_parent_origin=${encodeURIComponent(parentOrigin)}`;
  ok(true, `sandbox serving real bundle at ${sandboxOrigin}`);

  const idx = await fetch(indexUrl).then((r) => r.text());
  ok(/_next\/static/.test(idx), 'real shell index.html served (has _next chunks)');
  ok(/__LC_TRUSTED_PARENT_ORIGINS__/.test(idx), 'trusted parent origins injected into index.html');
  pageHtml = parentPageHtml(indexUrl, sandboxOrigin);

  const errors = [];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${parentOrigin}/`, { waitUntil: 'domcontentloaded' });

    const frame = page.frameLocator('#shell');
    await frame.locator('svg.recharts-surface').waitFor({ state: 'visible', timeout: 25_000 });
    ok(true, 'recharts <svg.recharts-surface> rendered inside sandbox iframe');

    const lineCount = await frame.locator('path.recharts-line-curve').count();
    ok(lineCount >= 1, `recharts line path present (count=${lineCount})`);

    const refused = await frame.locator('#__lc_error').count();
    ok(refused === 0, 'no shell error state (#__lc_error absent)');
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => sandboxServer.close(r));
    await new Promise((r) => ps.close(r));
  }

  if (errors.length) console.log('  (browser console errors:', errors.slice(0, 3), ')');
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS: artifact sandbox render smoke' : `\nFAIL: ${failures} assertion(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nFAIL (threw):', err);
    process.exit(1);
  });

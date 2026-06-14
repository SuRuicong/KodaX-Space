// E2E (F056): HtmlArtifact 安全属性真验 —— iframe sandbox="" 禁脚本。
//
// HtmlArtifact 把 AI 产出的静态 HTML 放进 `<iframe srcdoc sandbox="">`。安全完全
// 依赖空 sandbox 禁脚本/表单/弹窗。本测在真浏览器里嵌一段带 <script> 的 HTML,断言:
//   ① 良性内容渲染(#benign 在);② 脚本未执行(#executed 不在,且 parent 未被污染)。
// 纯 mjs + Playwright(不用 tsx,避开 package.json require 坑)。
// 运行: env -u ELECTRON_RUN_AS_NODE node e2e/artifact-html-sandbox.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

function htmlAttrEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The artifact HTML an attacker-ish AI might produce: benign content + a script
// that tries to run (mutate its own DOM + poke the parent).
const ARTIFACT_HTML = `<!doctype html><html><body>
<b id="benign">hello-artifact</b>
<script>
  try { window.parent.__HACKED__ = true; } catch (e) {}
  document.body.insertAdjacentHTML('beforeend', '<i id="executed">ran</i>');
</script>
</body></html>`;

// Parent page mounts the iframe EXACTLY like HtmlArtifact: srcdoc + sandbox="".
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<iframe id="a" sandbox="" srcdoc="${htmlAttrEscape(ARTIFACT_HTML)}" style="width:90vw;height:80vh;border:0"></iframe>
</body></html>`;

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });

    // sandbox attribute is exactly empty (no allow-scripts).
    const sandboxAttr = await page.locator('#a').getAttribute('sandbox');
    ok(sandboxAttr === '', `iframe sandbox is empty string (got ${JSON.stringify(sandboxAttr)})`);

    const frame = page.frameLocator('#a');
    await frame.locator('#benign').waitFor({ state: 'attached', timeout: 10_000 });
    ok(true, 'benign static content rendered (#benign present)');

    // Give any (illegitimately running) script a beat to mutate the DOM.
    await page.waitForTimeout(500);
    const executedCount = await frame.locator('#executed').count();
    ok(executedCount === 0, `script did NOT execute (#executed count=${executedCount}, expected 0)`);

    const hacked = await page.evaluate(() => Boolean(window.__HACKED__));
    ok(hacked === false, 'parent window not polluted by sandboxed script');
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS: HtmlArtifact sandbox blocks scripts' : `\nFAIL: ${failures} assertion(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nFAIL (threw):', err);
    process.exit(1);
  });

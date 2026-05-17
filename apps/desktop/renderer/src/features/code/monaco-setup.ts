// Monaco editor worker setup — F009.
//
// 默认 `@monaco-editor/react` 会从 jsdelivr CDN 拉 monaco——我们的 CSP 锁死 connect-src 'self'，
// CDN 拉不到。所以这里：
//   1. 把 monaco-editor 作为 npm 依赖打进 bundle
//   2. 用 Vite 的 ?worker 把 editor.worker 一起打包（CSP worker-src 'self' blob: 已放行）
//   3. loader.config({ monaco }) 让 @monaco-editor/react 用本地实例而非 CDN
//
// 注意：v0.1.0 只接 editor.worker（plain text + 主题）—— 不接 ts/json/css/html 等 language workers。
// 我们的 viewer 是 read-only，不需要语言服务；省 ~6 MB 包体。

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
// Vite ?worker 后缀返回 `new () => Worker`。TS 由 vite/client 三角注释提供该类型，
// 在本工程下渲染端 tsconfig 已 include vite/client.d.ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

let initialized = false;

/** 调一次即可：configure Monaco worker + loader. 应在 app 启动早期调（idempotent）。*/
export function initMonacoOnce(): void {
  if (initialized) return;
  initialized = true;

  // 全局 MonacoEnvironment：所有 editor 实例创建 worker 时走这里
  (window as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  // 把本地 monaco 注入 @monaco-editor/react，绕过默认 CDN loader
  loader.config({ monaco });
}

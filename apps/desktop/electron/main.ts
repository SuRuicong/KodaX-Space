// Electron main process entry — FEATURE_001
//
// 架构判断（详见 docs/HLD.md §1.2 + docs/ADR/ADR-003）：
// - main 拥有 OS event loop、KodaX runtime（后续 FEATURE_003 接入）
// - renderer 仅 UI，不直接 import LLM/KodaX runtime
// - 安全基线：contextIsolation / nodeIntegration=false / sandbox / CSP

import { app, BrowserWindow, shell, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerVersionChannel } from './ipc/version.js';
import { registerSessionChannels } from './ipc/session.js';
import { registerProjectChannels } from './ipc/project.js';
import { registerPermissionChannels } from './ipc/permission.js';
import { registerAskUserChannels } from './ipc/ask-user.js';
import { registerSlashChannels, registerBuiltinSlashCommands } from './ipc/slash.js';
import { registerSkillChannels } from './ipc/skill.js';
import { probeKodaxSdk } from './kodax/kodax-sdk-probe.js';
import { registerProviderChannels, injectAllKeysToEnv } from './ipc/provider.js';
import { registerFilesChannels } from './ipc/files.js';
import { setRendererTarget } from './ipc/push.js';
import { kodaxHost } from './kodax/host.js';
import { permissionRegistry } from './permission/registry.js';
import { permissionBroker } from './permission/broker.js';
import { askUserBroker } from './permission/ask-user-broker.js';
import { providerConfigStore } from './providers/config.js';

// CJS 输出（见 scripts/build-main.mjs），__dirname 是原生 Node 全局
// 不用 import.meta.url（CJS 下不可用）

// dev 环境从 vite dev server 加载；生产从打包后的 index.html 加载
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(VITE_DEV_SERVER_URL);

// 路径：dist-electron 与 apps/desktop/dist 是兄弟目录。
//
// dev:      __dirname = <root>/dist-electron      → ../apps/desktop/dist = <root>/apps/desktop/dist ✓
// prod asar: __dirname = app.asar/dist-electron   → ../apps/desktop/dist = app.asar/apps/desktop/dist ✓
//
// asar 兄弟关系成立的前提：electron-builder.yml 的 files glob 默认按项目根原样保留目录结构。
// 不改用 app.getAppPath()——dev 模式下 electron CLI 把 dist-electron 当应用目录，
// app.getAppPath() 会返回 <root>/dist-electron，再拼 apps/desktop/dist 反而错。
const RENDERER_DIST = path.join(__dirname, '../apps/desktop/dist');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// 用 pathToFileURL 严格构造 file:// 前缀。
// 关键点：Windows 上 Electron 实际加载的 URL 形如 `file:///C:/...`（三斜杠），手拼 `'file://' + path` 会少一个斜杠。
// 用 pathToFileURL 拿 href 末尾会带 `/`，再去尾保留作为前缀，能正确匹配子路径。
const ALLOWED_FILE_PREFIX = pathToFileURL(RENDERER_DIST).href.replace(/\/?$/, '/');

let mainWindow: BrowserWindow | null = null;

function applyCsp(): void {
  // CSP：renderer 只允许 self；dev 时放行 vite HMR（仅 script-src/connect-src）
  // 注：style-src 'unsafe-inline' 保留——React/shadcn/Radix 的内联 style props 需要；
  // 风险面在 Electron 本地环境足够小（无第三方 CSS 注入向量）。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // F009 CSP 扩项：
    //   - worker-src 'self' blob:  → Monaco editor 用 Web Worker（dev 走 module worker；prod 走 blob）
    //   - script-src 加 blob:       → 同上，Monaco esm worker 通过 blob URL 起
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self' blob:",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self'",
        ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'KodaX Space',
    backgroundColor: '#0b0b0c',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // 外链白名单：只允许 https:// 走系统浏览器；http:// 与其他 scheme 直接 deny。
  // 理由：renderer 终会渲染 LLM/MCP 产生的内容，http:// 链接可能触发本机协议处理器或
  // 中间人篡改的 OAuth/auth 流；强约束只放行 https。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 阻断 in-page 导航到任何非应用资源。
  // - dev: 仅放行 Vite dev server origin
  // - prod: 仅放行打包目录下的 file:// 路径（防止 LLM 注入 file:///etc/passwd 等任意路径）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = Boolean(isDev && VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL));
    const isAllowedLocalFile = url.startsWith(ALLOWED_FILE_PREFIX);
    if (isDevServer || isAllowedLocalFile) return;

    event.preventDefault();
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(() => {
  applyCsp();
  // KodaX SDK shape 漂移 fail-fast：若 ambient .d.ts 与运行时 SDK 不一致，
  // 启动期就 throw 比"用户发第一条 prompt 时白屏"更早被发现 (reviewer batch HIGH-2)。
  probeKodaxSdk();
  // IPC handlers 必须在窗口创建前注册——否则 renderer 启动后立刻调 invoke 会撞上 "No handler registered"
  registerVersionChannel();
  registerSessionChannels();
  registerProjectChannels();
  registerPermissionChannels();
  registerAskUserChannels();
  registerBuiltinSlashCommands();
  registerSlashChannels();
  registerSkillChannels();
  registerProviderChannels();
  registerFilesChannels();
  // push 目标走 getter 间接拿当前 window——dev HMR / 用户重开窗口都能正确切换
  setRendererTarget(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));
  // 预加载 always-allow 规则 — broker.request 走 matches() 是同步路径，必须事先 load。
  // 失败不阻塞启动（registry.load 内部 catch 后 cached 落为 []）。
  void permissionRegistry.load();
  // FEATURE_004 启动期把 keychain 里的 key 注入 process.env，
  // 让 KodaX SDK（getProvider）从 env 读到。失败不阻塞启动——provider 配置 UI 仍能用
  void providerConfigStore.load().then(() => injectAllKeysToEnv()).catch((err) => {
    console.error('[main] inject keychain keys to env failed:', err instanceof Error ? err.message : err);
  });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 关闭前清空所有活跃 session——Mock 阶段只是 abort 内存里的 AbortController，
// Real adapter 接入后会负责 kill 工具子进程、关 FileSessionStorage 句柄、断 HTTP 流。
// 不放在 will-quit 是因为那时 event loop 即将停，async dispose 容易跑不完。
//
// review H3-code（2026-05-17）：先 cancelAll pending 权限请求——disposeAll 会
// 逐 session cancelSession，但循环被打断时（before-quit 第二次触发等）仍有 pending
// 可能残留。先一把扫光，幂等
app.on('before-quit', (event) => {
  permissionBroker.cancelAll('shutdown');
  askUserBroker.cancelAll('shutdown');
  if (kodaxHost.list().length === 0) return;
  event.preventDefault();
  void kodaxHost
    .disposeAll()
    .catch((err) => console.error('[main] disposeAll on quit:', err instanceof Error ? err.message : err))
    .finally(() => app.exit(0));
});

// 兜底 — 未捕获异常不静默，但**不打印原对象**：
// Error 对象的字段（`.cause` / `.config` / 自定义属性）可能携带 API key、prompt、用户文件内容等。
// 只取 message + stack（堆栈是开发者已知敏感信息但远比整对象低风险）。
function sanitizeError(input: unknown): { name: string; message: string; stack?: string } {
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack };
  }
  return { name: typeof input, message: String(input) };
}
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', sanitizeError(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', sanitizeError(reason));
});

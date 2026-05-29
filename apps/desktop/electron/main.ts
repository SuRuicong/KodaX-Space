// Electron main process entry — FEATURE_001
//
// 架构判断（详见 docs/HLD.md §1.2 + docs/ADR/ADR-003）：
// - main 拥有 OS event loop、KodaX runtime（后续 FEATURE_003 接入）
// - renderer 仅 UI，不直接 import LLM/KodaX runtime
// - 安全基线：contextIsolation / nodeIntegration=false / sandbox / CSP

import { app, BrowserWindow, Menu, shell, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerVersionChannel } from './ipc/version.js';
import { registerSessionChannels } from './ipc/session.js';
import { registerProjectChannels } from './ipc/project.js';
import { registerPermissionChannels } from './ipc/permission.js';
import { registerAskUserChannels } from './ipc/ask-user.js';
import { registerSlashChannels, registerBuiltinSlashCommands } from './ipc/slash.js';
import { registerSkillChannels } from './ipc/skill.js';
import { registerAgentChannels } from './ipc/agent.js';
import { registerMcpChannels } from './ipc/mcp.js';
import { prewarmSdkMcpStore } from './mcp/config-reader.js';
import { registerKodaxChannels } from './ipc/kodax.js';
import { registerQueueChannels, startQueueWatch } from './ipc/queue.js';
import { prewarmKodaxUserConfig, registerKodaxCustomProviders } from './kodax/user-config.js';
import { probeKodaxSdk } from './kodax/kodax-sdk-probe.js';
import { probeSkillRegistry } from './skill/registry.js';
import { hydrateShellEnvOnce } from './kodax/shell-env-hydrate.js';
import { registerProviderChannels, injectAllKeysToEnv } from './ipc/provider.js';
import { registerFilesChannels } from './ipc/files.js';
import { registerTitlebarChannels } from './ipc/titlebar.js';
import { registerSettingsChannels } from './ipc/settings.js';
import { settingsStore } from './settings/store.js';
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
  // 自定义 titlebar — 对齐 VSCode / Discord / Slack 现代 chrome：
  //   - titleBarStyle: 'hidden' 把系统标题栏隐掉
  //   - Windows: titleBarOverlay 让 OS 仍画 close/min/max 但颜色对齐 zinc-950 theme
  //   - macOS: 'hiddenInset' 自动 (Electron 自动 fallback) 让 traffic lights 留在左上角
  //
  // renderer 顶部 row 用 CSS `-webkit-app-region: drag` 当拖动条；按钮 'no-drag'。
  // Menu.setApplicationMenu(null) 在 app.whenReady 里彻底禁掉默认 File/Edit/View 菜单。
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'KodaX Space',
    backgroundColor: '#0b0b0c',
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isWin
      ? {
          color: '#0b0b0c',
          symbolColor: '#a1a1aa',
          height: 36,
        }
      : undefined,
    autoHideMenuBar: true, // Linux: 按 Alt 也不展开 (Win 上由 titleBarStyle:hidden 已无菜单)
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
    // dev mode 也不再自动开 DevTools——用户用 View → Toggle Developer Tools 菜单或
    // Ctrl+Shift+I 快捷键按需打开。默认开会让首次启动多个浮窗显得突兀。
    // 若开发期想要自动打开，设环境变量 SPACE_AUTO_DEVTOOLS=1。
    if (process.env.SPACE_AUTO_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(async () => {
  // Minimal application menu — 仅 View / Window，保留 DevTools / Reload / Zoom /
  // Fullscreen 等开发与可访问性入口。其它（File / Edit / Help 等）我们没有真实操作可放，
  // 不构造菜单避免视觉噪音。
  //
  // Mac 上 macOS 强制顶部 menubar；Windows / Linux 上呈现为窗口顶部菜单条。
  const menu = Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
  applyCsp();
  // 启动期 3 个 async 任务无强依赖关系，并行跑省 300-800ms 才到窗口创建：
  //   - hydrateShellEnvOnce: 读 user shell rc 把 export 的 API key 流进 process.env
  //   - probeKodaxSdk: SDK shape 漂移 fail-fast (FEATURE shipper guard)
  //   - probeSkillRegistry: SkillRegistry subpath fail-fast
  // 三个都是 fail-fast 类，只决定"是否致命错误终止启动"，没有 ordering 依赖。
  // shell env hydration 与 keychain key 注入的 ordering 还是保留——后者跟在
  // providerConfigStore.load 后面，本块完成时一定还没跑到，env 已经填好可读。
  await Promise.all([
    hydrateShellEnvOnce(),
    probeKodaxSdk(),
    probeSkillRegistry(),
  ]);
  // IPC handlers 必须在窗口创建前注册——否则 renderer 启动后立刻调 invoke 会撞上 "No handler registered"
  registerVersionChannel();
  registerSessionChannels();
  registerProjectChannels();
  registerPermissionChannels();
  registerAskUserChannels();
  registerBuiltinSlashCommands();
  registerSlashChannels();
  registerSkillChannels();
  registerAgentChannels();
  registerMcpChannels();
  registerKodaxChannels();
  registerQueueChannels();
  // v0.1.6 cleanup: 预热 SDK MCP module 让首次 mcp.discover 不命中空 fallback
  // （DEFAULT_IMPL 首次同步调返回 {}，prewarm 异步触发后续调用走真 SDK）
  void prewarmSdkMcpStore();
  // v0.1.6 cleanup: 同上，预热 root SDK module + 把 ~/.kodax/config.json 的 customProviders
  // 注册进 SDK runtime LLM registry。完成后 `/provider <name>` 可切到 KodaX-CLI 配的
  // 自定义 provider（如用户的 newapi-anthropic / openrouter-xxx）。失败不阻塞启动。
  void prewarmKodaxUserConfig().then(() => registerKodaxCustomProviders());
  registerProviderChannels();
  registerFilesChannels();
  registerTitlebarChannels();
  registerSettingsChannels();
  // 启动期保证默认 workspace 目录存在 (~/kodax_workspace 或用户改过的路径)。
  // 不阻塞窗口创建——mkdir 失败 (磁盘满 / 权限) 不致命，UI 仍能用 + 用户可走 Open folder.
  void settingsStore.ensureWorkspaceExists();
  // push 目标走 getter 间接拿当前 window——dev HMR / 用户重开窗口都能正确切换
  setRendererTarget(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));
  // KodaX SDK MessageQueue (process-global) 订阅 — 实时把 enqueued/dequeued/cleared 推 renderer.
  // 失败 (SDK chunk import 错) 不阻塞启动,renderer 仍能调 kodax.queueGet 轮询。
  void startQueueWatch().catch((err) => {
    console.warn('[main] startQueueWatch failed:', err instanceof Error ? err.message : err);
  });
  // FEATURE_083 FileTracingProcessor (opt-in): 设 SPACE_TRACE_DIR=/some/abs/path 后启动期注册,
  // SDK 把 span/trace lifecycle JSONL 写入该目录。默认不写 (避免文件落盘而用户不知情)。
  void startFileTracingIfEnabled().catch((err) => {
    console.warn('[main] file tracing init failed:', err instanceof Error ? err.message : err);
  });
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

// FileTracingProcessor 启用入口 — opt-in via env SPACE_TRACE_DIR (绝对路径)。
// 设置后 SDK 把所有 span lifecycle 写到该目录的 JSONL。诊断诡异 bug 时启用。
let _fileTracingShutdown: (() => Promise<void>) | null = null;
async function startFileTracingIfEnabled(): Promise<void> {
  const traceDir = process.env.SPACE_TRACE_DIR;
  if (!traceDir || traceDir.length === 0) return;
  // 安全: 必须 abs path (避免相对路径在 unpacked Electron app 路径误指向 app.asar)
  if (!path.isAbsolute(traceDir)) {
    console.warn(`[main] SPACE_TRACE_DIR must be absolute (got: ${traceDir}); tracing disabled`);
    return;
  }
  try {
    const agentMod = await import('@kodax-ai/kodax/agent');
    const processor = new agentMod.FileTracingProcessor({ traceDir });
    agentMod.addTracingProcessor(processor);
    _fileTracingShutdown = () => processor.shutdown();
    console.info(`[main] FileTracingProcessor enabled → ${traceDir}`);
  } catch (err) {
    console.warn('[main] FileTracingProcessor failed to load:', err instanceof Error ? err.message : err);
  }
}

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
  // FileTracingProcessor.shutdown() 必须在退出前调,刷 pending write 到磁盘。
  // 即便没 in-flight session 也得 flush — 单独 fire-and-forget,quit 不等它。
  if (_fileTracingShutdown !== null) {
    const shutdown = _fileTracingShutdown;
    _fileTracingShutdown = null;
    void shutdown().catch((err) =>
      console.warn('[main] tracing shutdown:', err instanceof Error ? err.message : err),
    );
  }
  if (kodaxHost.listInFlight().length === 0) return;
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

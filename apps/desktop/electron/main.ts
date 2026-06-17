// Electron main process entry — FEATURE_001
//
// 架构判断（详见 docs/HLD.md §1.2 + docs/ADR/ADR-003）：
// - main 拥有 OS event loop、KodaX runtime（后续 FEATURE_003 接入）
// - renderer 仅 UI，不直接 import LLM/KodaX runtime
// - 安全基线：contextIsolation / nodeIntegration=false / sandbox / CSP

import { app, BrowserWindow, Menu, shell, session, dialog } from 'electron';
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
import { disposeMcpManager } from './mcp/manager.js';
import { registerKodaxChannels } from './ipc/kodax.js';
import { registerQueueChannels, startQueueWatch } from './ipc/queue.js';
import { prewarmKodaxUserConfig, registerKodaxCustomProviders } from './kodax/user-config.js';
import { probeKodaxSdk } from './kodax/kodax-sdk-probe.js';
import { probeSkillRegistry } from './skill/registry.js';
import { hydrateShellEnvOnce } from './kodax/shell-env-hydrate.js';
import { registerProviderChannels, injectAllKeysToEnv } from './ipc/provider.js';
import { autoActivateProvidersFromEnv } from './providers/auto-activate.js';
import { registerFilesChannels } from './ipc/files.js';
import { registerTitlebarChannels } from './ipc/titlebar.js';
import { registerSettingsChannels } from './ipc/settings.js';
import { registerNotificationChannels, setNotificationWindowGetter } from './ipc/notification.js';
import { registerUpdaterChannels, initAutoUpdater } from './ipc/updater.js';
import { registerMcpbChannels, installMcpbFromOsHandoff } from './ipc/mcpb.js';
import { registerTerminalChannels } from './ipc/terminal.js';
import { registerClipboardChannels } from './ipc/clipboard.js';
import { registerArtifactChannels } from './ipc/artifact.js';
import { registerArtifactWindowChannel } from './artifact/artifact-window.js';
import { installNavigationGuards } from './window/navigation-guards.js';
import { sandboxHost } from './artifact/sandbox-host.js';
import { cleanupOrphanKodaxSpaceDirWithLog } from './kodax/cleanup-orphan-kodax-space.js';
import { getPtyHost } from './terminal/ptyHost.js';
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

// THEME_BOOTSTRAP_INLINE_HASH 抽到 csp-config.ts 让单测无 electron 依赖也能 import
import { THEME_BOOTSTRAP_INLINE_HASH } from './csp-config.js';

let mainWindow: BrowserWindow | null = null;

function applyCsp(): void {
  // CSP：renderer 只允许 self；dev 时放行 vite HMR（仅 script-src/connect-src）
  // 注：style-src 'unsafe-inline' 保留——React/shadcn/Radix 的内联 style props 需要；
  // 风险面在 Electron 本地环境足够小（无第三方 CSS 注入向量）。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // F009 CSP 扩项：
    //   - worker-src 'self' blob:  → Monaco editor 用 Web Worker（dev 走 module worker；prod 走 blob）
    //   - script-src 加 blob:       → 同上，Monaco esm worker 通过 blob URL 起
    //   - script-src 加 hash       → apps/desktop/index.html 的 theme-bootstrap inline 脚本（v0.1.7 修：
    //     dist build 模式下没有 'unsafe-inline'，inline 脚本被 CSP 拦截 → 首帧 light flash。
    //     hash 跟 inline 脚本字符 1:1 锁定；inline 改了 hash 也要改，否则 csp-hash test 会拦下。
    //     hash 与单测同源派生：apps/desktop/electron/test/csp-inline-hash.test.ts 启动 read +
    //     compute 一遍 assert 匹配，未来 inline 漂移 CI 立刻报错）
    // frame-src 放行 artifact sandbox 的 loopback origin（F048 路径 D：renderer 以
    // <iframe> 嵌 http://127.0.0.1:<port> 的 sandbox-shell）。仅 127.0.0.1（+dev 的
    // localhost），不放宽其它。无 frame-src 时 default-src 'self' 会拦掉 iframe。
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "frame-src 'self' http://127.0.0.1:* http://localhost:*",
          "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
        ].join('; ')
      : [
          "default-src 'self'",
          `script-src 'self' '${THEME_BOOTSTRAP_INLINE_HASH}' blob:`,
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "frame-src 'self' http://127.0.0.1:*",
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

  // 外链白名单 + in-page 导航锁定 —— 与 artifact 独立窗口共用同一套守卫（F059c），
  // 避免两处窗口的安全策略漂移。理由：renderer 终会渲染 LLM/MCP 产生的内容，必须
  // 只放行应用自身资源（dev: Vite origin / prod: 打包 file:// 前缀），https 外链走系统
  // 浏览器，其余一律 deny（防 LLM 注入 file:///etc/passwd 等任意路径）。
  installNavigationGuards(mainWindow.webContents, {
    devServerUrl: VITE_DEV_SERVER_URL,
    allowedFilePrefix: ALLOWED_FILE_PREFIX,
    openExternal: (url) => void shell.openExternal(url),
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

// OC-01 单实例锁：HLD §10.3「No-duplicate-session-truth」要求同时只能有一个 Space 进程
// 写 ~/.kodax/，否则 projects.json / sessions 可能被并发写花。
// app.requestSingleInstanceLock() 必须在 app.whenReady() 之前调，第二个进程会立即 quit。
// 第一个进程收到 second-instance 事件 → show + focus 已有窗口（Slack/Discord 同款行为）。
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // F021 v0.1.5：Windows / Linux 上"双击 .mcpb"会以 second-instance 启动并把 path
    // 塞进 argv。第一个进程在这里挑出 mcpb-like 路径转给 installer。
    // argv 第 0 项是 electron / Space binary 自身，1 之后才是用户传入。
    const mcpbPath = pickMcpbPathFromArgv(argv);
    if (mcpbPath !== null) {
      void installMcpbFromOsHandoff(mcpbPath);
    }
  });
}

/**
 * F021 v0.1.5：从 process.argv / second-instance argv 里挑 .mcpb / .dxt 后缀路径。
 * 跳过非 path 前缀 (--switch=value)；只接受第一个匹配（再多视为用户误操作）。
 * security review MED-1：必须 abs path —— 相对路径可能被 cwd 攻击者误指（启动 Space 时
 * cwd 由 OS 决定，但 second-instance 触发时 cwd = 调用方进程当前目录，可能不可信）。
 */
function pickMcpbPathFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue; // 跳过 electron flags
    const lower = arg.toLowerCase();
    if (!lower.endsWith('.mcpb') && !lower.endsWith('.dxt')) continue;
    if (!path.isAbsolute(arg)) continue; // 拒绝 ../evil.mcpb 等相对路径
    return arg;
  }
  return null;
}

/**
 * F021 v0.1.5：macOS 文件关联 / open-file 事件。
 * 必须在 app.whenReady() 之前注册才能接到冷启动 open-file（用户双击 .mcpb 启动 Space 时，
 * open-file 在 ready 前就发出，错过 listener 就丢）。
 * 已运行时再 open-file 一并接到这里。
 */
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  // app 还没 ready 时（冷启动场景）也合法 — installMcpbFromOsHandoff 内部 await Notification
  // 的 Electron API 会在 ready 后才生效；我们用 whenReady() 等一下再调
  void app.whenReady().then(() => installMcpbFromOsHandoff(filePath));
});

app.whenReady().then(async () => {
  // Minimal application menu — App(mac) / Edit / View / Window。
  // Edit 菜单是 macOS 上 Cmd+C/V/X/A/Z 等编辑快捷键能工作的必要条件（经 role 分发），
  // 不构造则这些快捷键在 mac 上完全失效；Win/Linux 由 Chromium 原生处理，菜单仅作展示。
  // File / Help 等没有真实操作，不构造避免视觉噪音。
  //
  // Mac 上 macOS 强制顶部 menubar；Windows / Linux 上呈现为窗口顶部菜单条。
  const isMac = process.platform === 'darwin';
  const menu = Menu.buildFromTemplate([
    // macOS 习惯首项为 app 菜单（含 Quit / Hide 等系统 role）。
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    // Edit 菜单：macOS 上 Cmd+C/V/X/A/Z 等标准编辑快捷键是经由这些 role 分发的，
    // 没有 Edit 菜单则这些快捷键在 mac 上完全失效（Win/Linux 由 Chromium 原生处理，不依赖菜单）。
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'View',
      // Zoom 不放菜单 role —— 缩放由 renderer 的 ZoomController 统一接管（Ctrl+滚轮 / Ctrl+± /
      // Ctrl+0 + 持久化系数 + 角标）。菜单 role 与 renderer keydown 会双触发导致一次按两档，故移除。
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
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
  // v0.1.10 chore: best-effort 清理早期残留的 ~/.kodax_space 孤儿目录。
  // fire-and-forget,never throws,不阻塞 UI 启动;详见 cleanup-orphan-kodax-space.ts。
  void cleanupOrphanKodaxSpaceDirWithLog();

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
  // F020 native OS notification — renderer 调 notification.show 弹 OS 原生通知
  registerNotificationChannels();
  setNotificationWindowGetter(() => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  // F022 auto-updater — packaged 模式下走 GitHub Releases feed；dev 模式 idle
  // initAutoUpdater 内部判断 app.isPackaged + 异步触发首次 check，不阻塞窗口创建
  registerUpdaterChannels();
  void initAutoUpdater();
  // F021 .mcpb / .dxt bundle install — IPC handlers，UI 点 "Install extension..." 走
  registerMcpbChannels();
  // F011 内置终端 (xterm.js + node-pty) — terminal.create/write/resize/kill + output/exit push
  registerTerminalChannels();
  // OC-31 v0.1.9 clipboard image paste — renderer 把粘贴板图片落到 app temp dir
  registerClipboardChannels();
  // F048 路径 D artifact：自托管 LC sandbox bundle on 127.0.0.1（best-effort）。
  // bundle 未装（LC build:bundle 尚未产出可用产物，见记忆 livecanvas_gap_sandbox_bundle）
  // 时 ready:false，renderer 显示占位、不开端口。dev parentOrigin = Vite renderer origin
  // （sandbox 的 localhost bypass 接受）；prod renderer=file:// 无可比对 origin（留待 F055 app://）。
  registerArtifactChannels();
  // F059c L3：artifact.openWindow → 独立最大化窗口（复用同一 renderer + preload，走 #artifact hash）。
  registerArtifactWindowChannel({
    preloadPath: PRELOAD_PATH,
    rendererDist: RENDERER_DIST,
    devServerUrl: VITE_DEV_SERVER_URL,
  });
  const sandboxParentOrigin = isDev && VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : '';
  void sandboxHost
    .start({
      parentOrigin: sandboxParentOrigin,
      envOverride: process.env.SPACE_LC_SANDBOX_BUNDLE,
    })
    .then((info) => {
      if (info.ready) {
        console.info('[main] artifact sandbox serving at', info.sandboxOrigin);
        // F055 gap: with no parent origin to pin, `frame-ancestors` degrades to
        // 'self' only and the sandbox is NOT origin-isolated from a rogue local
        // framer. Only reachable if a bundle is dropped into a packaged build
        // before F055 lands (dev always has the Vite origin). Make it loud.
        if (!sandboxParentOrigin) {
          console.warn(
            '[main] artifact sandbox started with NO parent origin — framing is unrestricted ' +
              '(packaged app:// host pinning lands in F055). Treat as non-isolated until then.',
          );
        }
      } else {
        console.info('[main] artifact sandbox not ready:', info.error);
      }
    })
    .catch((err) => console.warn('[main] sandbox host start failed:', err instanceof Error ? err.message : err));
  // F021 v0.1.5 冷启动 file association：用户双击 .mcpb 启动 Space 时，path 在 process.argv 里。
  // mainWindow 还没创建，但 installMcpbFromOsHandoff 内部会拉 BrowserWindow.getAllWindows()[0]
  // ——等 createMainWindow() 跑完才有 window。fire-and-forget，让 window 先建好。
  const initialMcpb = pickMcpbPathFromArgv(process.argv);
  if (initialMcpb !== null) {
    void installMcpbFromOsHandoff(initialMcpb);
  }
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
  // KX-I-01：injectAllKeysToEnv 后 process.env 是最新状态，autoActivate 检测 shell-set
  // 的 env key 并在 defaultProviderId 为 null 时自动选首个匹配的 built-in 为默认。
  void providerConfigStore.load()
    .then(() => injectAllKeysToEnv())
    .then(() => autoActivateProvidersFromEnv())
    .catch((err) => {
      console.error('[main] inject keychain keys / auto-activate failed:', err instanceof Error ? err.message : err);
    });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((err) => {
  // 启动链兜底：whenReady 内任一步抛错（如 SDK chunk 缺运行时文件、动态 import 失败）原本会变成
  // unhandledRejection，且 createMainWindow() 不再执行 → 窗口永不出现，而 Windows GUI 子系统下
  // 控制台又收不到日志，用户只看到"app 打不开 / session 都没了"。这里捕获后：① 写日志
  // ② 弹原生错误框让失败可见 ③ 若尚无窗口则补建一个，让 app 至少起来（SDK 依赖型功能再各自经 IPC
  // 优雅报错，而非整个 app 静默消失）。
  // console 写完整信息（含 stack，供开发者在日志里排查）；给用户的 dialog 文案经
  // sanitizeForDialog 抹掉绝对路径（Win 下含用户名）并截断，避免共享屏幕/录屏时泄漏路径或
  // 错误对象里夹带的敏感串。
  console.error('[main] fatal during whenReady startup:', sanitizeError(err));
  try {
    dialog.showErrorBox(
      'KodaX Space 启动出错',
      `主进程启动时发生错误（完整信息见 ~/.kodax/space/logs/）：\n\n${sanitizeForDialog(err)}`,
    );
  } catch {
    /* dialog 不可用时也别再抛 */
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      createMainWindow();
    } catch (e) {
      console.error('[main] createMainWindow() in startup catch also failed:', sanitizeError(e));
    }
  }
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
//
// 进程残留修复（2026-06-16）：MCP stdio server / sandbox server 这些**会 spawn OS 子进程**
// 的子系统，之前是 fire-and-forget（`void dispose()`）。退出时序里没有 in-flight session
// 时 before-quit 直接 return → app.quit() 立刻拆主进程，子进程 kill 还没跑完 → MCP server
// 等 node 子进程变孤儿残留；有 in-flight 时 app.exit(0) 也只等了 kodaxHost.disposeAll()。
// 现在统一拦一次，把所有会杀子进程的异步清理一起 await 完再硬退；带看门狗兜底，避免任一
// 清理卡死导致无窗口僵尸主进程（dev 链路下还会连累 vite/esbuild 跟着挂）。
let _quitting = false;
app.on('before-quit', (event) => {
  // 同步 + 幂等的清理先做（每次 before-quit 触发都安全重入）。
  permissionBroker.cancelAll('shutdown');
  askUserBroker.cancelAll('shutdown');
  // F011: kill all PTYs before exit so shells don't outlive Electron as zombies.
  // disposeAll is synchronous + idempotent, never throws.
  try {
    getPtyHost().disposeAll();
  } catch (err) {
    console.warn('[main] ptyHost dispose:', err instanceof Error ? err.message : err);
  }

  // 第二次 before-quit（理论上不会——app.exit 跳过 before-quit；防 electron quirk）直接放行。
  if (_quitting) return;
  _quitting = true;
  // 异步清理需要 await 完才能让进程死，否则子进程 kill 与进程退出赛跑 → 孤儿残留。
  event.preventDefault();

  const tracingShutdown = _fileTracingShutdown;
  _fileTracingShutdown = null;

  // 所有会 spawn 子进程 / 持有句柄的异步清理，统一收口后 allSettled。每个自带 catch，
  // 不让单个失败短路其它清理。
  const disposals: Promise<unknown>[] = [
    // McpManager: 释放 stdio transport 子进程,免得 quit 后 server 进程作为 zombie 留着。
    disposeMcpManager().catch((err) =>
      console.warn('[main] mcp shutdown:', err instanceof Error ? err.message : err),
    ),
    // F048 路径 D：关闭 loopback sandbox server（释放 127.0.0.1 端口）。
    sandboxHost.dispose().catch((err) =>
      console.warn('[main] sandbox host dispose:', err instanceof Error ? err.message : err),
    ),
    // KodaX in-flight session：abort + drain queue（dispose 本身很快，不 await SDK 后台 run）。
    kodaxHost
      .disposeAll()
      .catch((err) =>
        console.error('[main] disposeAll on quit:', err instanceof Error ? err.message : err),
      ),
  ];
  // FileTracingProcessor.shutdown(): 刷 pending write 到磁盘（opt-in，多数用户为 null）。
  if (tracingShutdown !== null) {
    disposals.push(
      tracingShutdown().catch((err) =>
        console.warn('[main] tracing shutdown:', err instanceof Error ? err.message : err),
      ),
    );
  }

  // 兜底看门狗：任一清理卡死也不让 app 永远不退。unref 不让它本身把 event loop 拖住。
  const watchdog = setTimeout(() => {
    console.warn('[main] shutdown disposals exceeded 2.5s; forcing exit');
    app.exit(0);
  }, 2500);
  watchdog.unref?.();

  void Promise.allSettled(disposals).finally(() => {
    clearTimeout(watchdog);
    app.exit(0);
  });
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
// 给用户 dialog 看的文案：只取 message（不含完整 stack），抹掉绝对路径（Win `C:\Users\<name>\…`、
// UNC `\\…`、POSIX `/a/b/c`），并截断到 500 字。完整 stack 仍写 console（开发者排查）。
function sanitizeForDialog(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input);
  const redacted = raw
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/\\\\[^\s'"]+/g, '<path>')
    // POSIX 绝对路径：至少含一个分隔符（覆盖 /Users/<name>/… 这类含用户名的家目录路径，
    // 单段如 /coding 不算敏感、不匹配）。比旧 [\w.-] 段宽，能吃到含空格/括号的路径剩余部分。
    .replace(/\/[\w.-]+\/[^\s'"]*/g, '<path>')
    .trim();
  const capped = redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
  return capped || 'unknown startup error';
}
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', sanitizeError(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', sanitizeError(reason));
});

// Keychain 封装 — FEATURE_004
//
// 用 `@napi-rs/keyring`（keytar 兼容层）把 API key 存到 OS 原生 keychain：
//   - macOS: Keychain Access
//   - Windows: Credential Manager
//   - Linux: libsecret (gnome-keyring / kwallet / ...)
//
// 为什么从 keytar 换成 @napi-rs/keyring（refactor，2026-06-17）：
//   keytar 已 archived 停维护，且是 node-gyp 源码编译的 native 模块——开发机系统 Node
//   的 ABI 与 Electron 内置 Node ABI 不一致时（如系统 Node 25 vs Electron 内置 Node 20），
//   会编出错 ABI 的 keytar.node，`require` 时 **native 层直接崩**（exit 0xFFFF7003），
//   JS 的 try/catch 拦不住，拖垮整个 app。@napi-rs/keyring 是纯 N-API + Rust，各平台
//   **自带 prebuild**，装下来直接匹配运行时，不走 node-gyp、不需要 C++ 构建工具、不存在
//   ABI 不匹配崩溃。其 `keytar` 兼容子入口导出与 keytar 完全相同的 API（getPassword /
//   setPassword / deletePassword / findCredentials），故本模块逻辑零改动，只换模块名。
//
// 服务名固定 `kodax-space`；账号名 = provider id（如 'anthropic'、'custom_abc12345'）。
// 与 KodaX CLI 不共享 keychain entry——CLI 用 env / config 读 key；
// Space 把 key 注入 process.env 后再起 SDK，CLI 跑 `kodax run` 时另有自己的注入路径。
//
// 错误处理：
//   - Linux 用户没装 libsecret 时 setPassword 抛错；本模块捕获后 fallback
//     到 process.env 内存存储 + 给 UI 一个明确的"keychain unavailable，本进程内有效"提示
//   - 进程退出后 fallback 存储丢失——这是合理的（不写盘明文 key）
//
// 安全：
//   - get/set/delete 都在 main 进程；renderer 永远拿不到 key
//   - 即使本模块 import 到 renderer，import 失败因 keyring 是 native module
//   - 但仍要警惕"main 端日志 / 错误 message" 泄漏 key——本模块永不打 key 值

// 不直接静态 `import` keyring——它是 native module，在没有对应平台 prebuild 的环境
// （罕见）/ Linux 无 libsecret 时运行期可能加载或调用失败。运行时动态 `import()` 失败时
// fallback 到 memory。这里自己声明用到的最小接口（与 keytar 兼容层一致）。
interface KeyringApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

const SERVICE_NAME = 'kodax-space';

// @napi-rs/keyring 的 keytar 兼容子入口——导出 getPassword/setPassword/deletePassword/findCredentials。
// 带 .js 后缀：该包无 `exports` 字段，ESM 动态 import 子路径必须显式扩展名（CJS require 也认）。
const KEYRING_MODULE_ID = '@napi-rs/keyring/keytar.js';

// 动态 import keyring——native module 在某些环境（无匹配 prebuild / Linux 无 libsecret）
// 加载或调用失败。失败时 fallback 到 in-memory store，并把状态 expose 出去让 UI 提示用户。
let keyringPromise: Promise<KeyringApi | null> | null = null;
function loadKeyring(): Promise<KeyringApi | null> {
  if (keyringPromise) return keyringPromise;
  // 用变量名躲开 esbuild / tsc 的 import resolution——加载失败时这里依然能 compile + run
  // （动态 import 抛错被 catch 后走 fallback）
  const moduleId = KEYRING_MODULE_ID;
  keyringPromise = import(/* @vite-ignore */ moduleId)
    .then((mod) => (mod as { default?: KeyringApi }).default ?? (mod as unknown as KeyringApi))
    .catch((err) => {
      console.warn(
        `[keychain] failed to load @napi-rs/keyring (falling back to in-memory): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    });
  return keyringPromise;
}

// In-memory fallback——key 只在本进程生命周期内有效。
const memoryStore = new Map<string, string>();

let backendStatus: 'unknown' | 'keychain' | 'memory' = 'unknown';

async function detectBackend(): Promise<'keychain' | 'memory'> {
  if (backendStatus !== 'unknown') return backendStatus;
  const keyring = await loadKeyring();
  if (!keyring) {
    backendStatus = 'memory';
    return 'memory';
  }
  // 探针：尝试一次 findCredentials；失败就走 memory
  try {
    await keyring.findCredentials(SERVICE_NAME);
    backendStatus = 'keychain';
  } catch (err) {
    console.warn(
      `[keychain] backend probe failed (falling back to in-memory): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    backendStatus = 'memory';
  }
  return backendStatus;
}

/**
 * 当前 keychain backend 状态。
 *   - 'keychain'：OS 原生
 *   - 'memory'：本进程内存（key 进程退出后丢失）
 *
 * UI 用它显示"⚠️ keychain unavailable" 告警。
 */
export async function getBackendStatus(): Promise<'keychain' | 'memory'> {
  return detectBackend();
}

/**
 * 写 key。account 应为 provider id。
 * 抛错只在严重失败时（disk full / 权限拒绝）——日常 backend 异常已 fallback 到 memory。
 */
export async function setKey(account: string, secret: string): Promise<void> {
  const backend = await detectBackend();
  if (backend === 'memory') {
    memoryStore.set(account, secret);
    return;
  }
  const keyring = await loadKeyring();
  if (!keyring) {
    memoryStore.set(account, secret);
    return;
  }
  try {
    await keyring.setPassword(SERVICE_NAME, account, secret);
  } catch (err) {
    // setPassword 失败（一般是 libsecret 在跑时崩了）——降级到 memory，
    // 同时把 backend 标 memory 让 UI 后续也知道
    console.warn(
      `[keychain] setPassword failed, falling back to memory: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    backendStatus = 'memory';
    memoryStore.set(account, secret);
  }
}

/**
 * 读 key。不存在返回 undefined。
 *   - 永远只在 main 进程内调用——renderer 不该 import 本模块
 *   - 启动期 env 注入会用这个批量读所有已配置的 key
 */
export async function getKey(account: string): Promise<string | undefined> {
  const backend = await detectBackend();
  if (backend === 'memory') {
    return memoryStore.get(account);
  }
  const keyring = await loadKeyring();
  if (!keyring) {
    return memoryStore.get(account);
  }
  try {
    const value = await keyring.getPassword(SERVICE_NAME, account);
    return value ?? undefined;
  } catch (err) {
    console.warn(
      `[keychain] getPassword failed for account=${account}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return memoryStore.get(account);
  }
}

/** 删 key。返回是否实际删了一条记录。*/
export async function deleteKey(account: string): Promise<boolean> {
  const backend = await detectBackend();
  if (backend === 'memory') {
    return memoryStore.delete(account);
  }
  const keyring = await loadKeyring();
  if (!keyring) {
    return memoryStore.delete(account);
  }
  try {
    const removed = await keyring.deletePassword(SERVICE_NAME, account);
    // 镜像 memory（防 backend 切换后残留）
    memoryStore.delete(account);
    return removed;
  } catch (err) {
    console.warn(
      `[keychain] deletePassword failed for account=${account}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return memoryStore.delete(account);
  }
}

/**
 * 列出所有 account 名（不含 key 值）。
 * 启动期 env 注入用：先 listAccounts，再针对每个 account 调 getKey 拿值。
 *
 * 注意：findCredentials 返回的是 `{ account, password }[]`，password 字段
 * 是明文 key——为了避免把 key 推给上层导致泄漏，本接口只回 account 名，
 * 上层要 key 必须显式调 getKey(account)。
 */
export async function listAccounts(): Promise<readonly string[]> {
  const backend = await detectBackend();
  if (backend === 'memory') {
    return [...memoryStore.keys()];
  }
  const keyring = await loadKeyring();
  if (!keyring) {
    return [...memoryStore.keys()];
  }
  try {
    const entries = await keyring.findCredentials(SERVICE_NAME);
    return entries.map((e) => e.account);
  } catch (err) {
    console.warn(
      `[keychain] findCredentials failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [...memoryStore.keys()];
  }
}

/**
 * 测试用：清空 memory store **并强制 backend=memory**。
 *
 * 为什么强制 memory：测试机如果落了 keyring native prebuild，
 * 真实 OS keychain 里残留的 entries（之前用过的 dev keys）会污染 listAccounts 结果。
 * 单测必须跑在隔离 backend 上——任何 set/list 都走 memory store。
 */
export function _resetMemoryStoreForTesting(): void {
  memoryStore.clear();
  // 跳过 detectBackend：直接锁定 'memory'，detectBackend 早返回
  backendStatus = 'memory';
  // keyringPromise 不重置——keep 它指向 null 或 loaded module 都行，
  // backendStatus='memory' 让所有路径都走 memoryStore，不会触达 keyring
}

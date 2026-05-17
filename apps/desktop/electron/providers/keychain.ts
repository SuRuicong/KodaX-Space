// Keychain 封装 — FEATURE_004
//
// 用 `keytar` 把 API key 存到 OS 原生 keychain：
//   - macOS: Keychain Access
//   - Windows: Credential Manager
//   - Linux: libsecret (gnome-keyring / kwallet / ...)
//
// 服务名固定 `kodax-space`；账号名 = provider id（如 'anthropic'、'custom_abc12345'）。
// 与 KodaX CLI 不共享 keychain entry——CLI 用 env / config 读 key；
// Space 把 key 注入 process.env 后再起 SDK，CLI 跑 `kodax run` 时另有自己的注入路径。
//
// 错误处理：
//   - Linux 用户没装 libsecret 时 keytar.setPassword 抛错；本模块捕获后 fallback
//     到 process.env 内存存储 + 给 UI 一个明确的"keychain unavailable，本进程内有效"提示
//   - 进程退出后 fallback 存储丢失——这是合理的（不写盘明文 key）
//
// 安全：
//   - get/set/delete 都在 main 进程；renderer 永远拿不到 key
//   - 即使本模块 import 到 renderer，import 失败因 keytar 是 native module
//   - 但仍要警惕"main 端日志 / 错误 message" 泄漏 key——本模块永不打 key 值

// 不直接 `import type ... from 'keytar'`——keytar 是 optionalDependencies，
// 在没装 C++ build tools 的开发机上可能没安装（npm 走 optionalDependencies 失败时不阻塞 install）。
// 我们自己声明 keytar 的最小接口，运行时 `import('keytar')` 失败时 fallback 到 memory。
interface KeytarApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

const SERVICE_NAME = 'kodax-space';

// 动态 import keytar——native module 在某些环境（CI 无原生编译链 / Linux 无 libsecret / 用户机器没装 keytar）
// 加载失败。失败时 fallback 到 in-memory store，并把状态 expose 出去让 UI 提示用户。
let keytarPromise: Promise<KeytarApi | null> | null = null;
function loadKeytar(): Promise<KeytarApi | null> {
  if (keytarPromise) return keytarPromise;
  // 用变量名躲开 esbuild / tsc 的 import resolution——optionalDependencies 没装时
  // 这里依然能 compile + run（动态 import 抛错被 catch 后走 fallback）
  const moduleId = 'keytar';
  keytarPromise = import(/* @vite-ignore */ moduleId)
    .then((mod) => (mod as { default?: KeytarApi }).default ?? (mod as unknown as KeytarApi))
    .catch((err) => {
      console.warn(
        `[keychain] failed to load keytar (falling back to in-memory): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    });
  return keytarPromise;
}

// In-memory fallback——key 只在本进程生命周期内有效。
const memoryStore = new Map<string, string>();

let backendStatus: 'unknown' | 'keychain' | 'memory' = 'unknown';

async function detectBackend(): Promise<'keychain' | 'memory'> {
  if (backendStatus !== 'unknown') return backendStatus;
  const keytar = await loadKeytar();
  if (!keytar) {
    backendStatus = 'memory';
    return 'memory';
  }
  // 探针：尝试一次 findCredentials；失败就走 memory
  try {
    await keytar.findCredentials(SERVICE_NAME);
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
  const keytar = await loadKeytar();
  if (!keytar) {
    memoryStore.set(account, secret);
    return;
  }
  try {
    await keytar.setPassword(SERVICE_NAME, account, secret);
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
  const keytar = await loadKeytar();
  if (!keytar) {
    return memoryStore.get(account);
  }
  try {
    const value = await keytar.getPassword(SERVICE_NAME, account);
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
  const keytar = await loadKeytar();
  if (!keytar) {
    return memoryStore.delete(account);
  }
  try {
    const removed = await keytar.deletePassword(SERVICE_NAME, account);
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
 * 注意：keytar.findCredentials 返回的是 `{ account, password }[]`，password 字段
 * 是明文 key——为了避免把 key 推给上层导致泄漏，本接口只回 account 名，
 * 上层要 key 必须显式调 getKey(account)。
 */
export async function listAccounts(): Promise<readonly string[]> {
  const backend = await detectBackend();
  if (backend === 'memory') {
    return [...memoryStore.keys()];
  }
  const keytar = await loadKeytar();
  if (!keytar) {
    return [...memoryStore.keys()];
  }
  try {
    const entries = await keytar.findCredentials(SERVICE_NAME);
    return entries.map((e) => e.account);
  } catch (err) {
    console.warn(
      `[keychain] findCredentials failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [...memoryStore.keys()];
  }
}

/**
 * 测试用：清空 memory store。仅 in-memory 模式有效。
 * 单测 beforeEach 用它隔离 state——keychain 模式下不动 OS keychain。
 */
export function _resetMemoryStoreForTesting(): void {
  memoryStore.clear();
  backendStatus = 'unknown';
  keytarPromise = null;
}

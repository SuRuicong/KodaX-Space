// Provider IPC handlers — FEATURE_004
//
// 7 个 invoke channel：
//   provider.list           列出 built-in + custom providers + configured 状态
//   provider.setKey         写 key（main → keychain；renderer 永不持有 key）
//   provider.removeKey      删 key
//   provider.test           HTTP probe 测连接
//   provider.setDefault     设默认 provider
//   provider.addCustom      新增自定义 provider
//   provider.removeCustom   删自定义 provider
//
// 安全约束：
//   - API key 只走 setKey 流向 main，绝不通过 list / 任何 push 回 renderer
//   - error envelope 内的错误字段已由 register.ts 兜底脱敏（不打原始 Error 对象）
//     这里再额外保证：handler 自己写的 error message 不含 key 值

import { registerChannel } from './register.js';
import { BUILTIN_PROVIDERS, isBuiltinId, getBuiltin } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import {
  setKey,
  deleteKey,
  getKey,
  listAccounts,
  getBackendStatus,
} from '../providers/keychain.js';
import { testProvider } from '../providers/test-connection.js';
import { validateBaseUrl } from '../providers/url-guard.js';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';

// review H2-sec：apiKeyEnv 黑名单——这些 env var 名一旦被 setKey 写入会引发
// 代码执行 / PATH 劫持。NODE_OPTIONS 是已知 Node 注入向量（--require / --loader）；
// PATH 改了之后所有 subprocess（KodaX bash tool 等）都会被劫持。
const RESERVED_ENV_VARS = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'PYTHONPATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
]);

/** 校验 apiKeyEnv 命名安全：大写蛇形 + 黑名单。返回 null 表示合法。*/
function validateApiKeyEnv(name: string): string | null {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name)) {
    return 'apiKeyEnv must match /^[A-Z_][A-Z0-9_]*$/ (uppercase snake)';
  }
  if (RESERVED_ENV_VARS.has(name)) {
    return `apiKeyEnv "${name}" is reserved and cannot be used`;
  }
  return null;
}

/** 校验 apiKey 不含会破坏 HTTP header 的字符（review C2-sec：CRLF injection）。*/
function validateApiKey(key: string): string | null {
  // \r \n \0 都会让 fetch undici 的 header serializer 抛错或（在老 runtime 上）
  // 注入额外 header。明确禁止，给 UI 一个清楚的报错而不是依赖 fetch 报错
  if (/[\r\n\0]/.test(key)) {
    return 'API key cannot contain CR, LF, or NUL bytes';
  }
  return null;
}

/**
 * 把 keychain 中的 key 注入 process.env。
 *   - main 启动后调一次（载入所有已配置的 key）
 *   - setKey / removeKey 后实时增量更新 env
 *   - 注入策略：按 provider 的 apiKeyEnv（如 ANTHROPIC_API_KEY）。
 *     多个 provider 共享同一 apiKeyEnv（kimi + kimi-code 都用 KIMI_API_KEY）时，
 *     **默认 provider 的 key 胜出**——其他共享同 env 的 provider 用同一个值
 *
 * review H4-code（2026-05-17）：原本只 set，不 unset。删 key 后 env 残留——
 * UI 显示 NOT SET 但 SDK 仍能用旧 key 直到进程重启。修复：构造"本次该出现的
 * apiKeyEnv 集合"，把所有由 Space 管的 apiKeyEnv 先清空，再按集合重新填回。
 * 这样多 provider 共享 env 时也能正确处理：删了 kimi-code 但 kimi 还在 → KIMI_API_KEY 保留 kimi 的 key
 *
 * review M4-sec：未知 account（旧版本残留、provider 被改名等）现在会 log warn
 * 而不是静默 drop——便于排查"我配了 key 但 SDK 看不见"
 */
export async function injectAllKeysToEnv(): Promise<void> {
  await providerConfigStore.load();
  const accounts = await listAccounts();
  const defaultId = providerConfigStore.getDefaultProviderId();

  // 1) 收集所有 Space 管理的 apiKeyEnv 名（built-in + custom），即"该被 Space 接管的 env"
  const managedEnvs = new Set<string>();
  for (const b of BUILTIN_PROVIDERS) managedEnvs.add(b.apiKeyEnv);
  for (const c of providerConfigStore.listCustom()) managedEnvs.add(c.apiKeyEnv);

  // 2) 清空所有 managed env——保证删 key 后旧值不残留
  for (const envName of managedEnvs) {
    delete process.env[envName];
  }

  // 3) 按 account 重新注入；未知 account 自动清掉（旧 dev key / 测试残留）
  //    v0.1.6: 之前只 log warn 不删，导致用户启动每次报一遍"a/b/c/x skipping"。
  //    detect 条件保守：account 不匹配任何已知 provider id (built-in catalog 稳定 +
  //    custom_<hex> CSPRNG 永不重生) → 安全删除。
  const orphanAccounts: string[] = [];
  for (const acct of accounts) {
    const info = resolveProviderInfo(acct);
    if (!info) {
      orphanAccounts.push(acct);
      continue;
    }
    const value = await getKey(acct);
    if (value) process.env[info.apiKeyEnv] = value;
  }
  if (orphanAccounts.length > 0) {
    console.info(
      `[provider] cleaning up ${orphanAccounts.length} orphan keychain account(s): ${orphanAccounts.join(', ')}`,
    );
    for (const acct of orphanAccounts) {
      try {
        await deleteKey(acct);
      } catch (err) {
        console.warn(
          `[provider] failed to delete orphan account "${acct}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  // 4) 默认 provider 的 key 最后注入一次——保证共享 env 时它胜出
  if (defaultId) {
    const info = resolveProviderInfo(defaultId);
    if (info) {
      const value = await getKey(defaultId);
      if (value) process.env[info.apiKeyEnv] = value;
    }
  }
}

/** 注入单条 key 的辅助：setKey 之后实时调用让 env 同步。*/
async function injectSingleKey(providerId: string): Promise<void> {
  const info = resolveProviderInfo(providerId);
  if (!info) return;
  const value = await getKey(providerId);
  if (value) process.env[info.apiKeyEnv] = value;
}

function resolveProviderInfo(
  id: string,
): { apiKeyEnv: string } | undefined {
  if (isBuiltinId(id)) {
    const b = getBuiltin(id);
    return b ? { apiKeyEnv: b.apiKeyEnv } : undefined;
  }
  const c = providerConfigStore.getCustom(id);
  return c ? { apiKeyEnv: c.apiKeyEnv } : undefined;
}

export function registerProviderChannels(): void {
  // provider.list
  registerChannel('provider.list', async () => {
    await providerConfigStore.load();
    const keychainAccounts = new Set(await listAccounts());
    const defaultId = providerConfigStore.getDefaultProviderId();

    // v0.1.6：configured 同时认两种来源——
    //   1) Space keychain 里存了 key (写时同时注入 process.env[apiKeyEnv])
    //   2) Space 启动前 shell 已经 export 了 apiKeyEnv (用户本地直接配 env，不走 Space 设置)
    // 之前只看 keychain，导致用户在 shell export 过 KIMI_API_KEY/ARK_API_KEY 等的 provider
    // 显示成 not configured，UI 让人困惑。
    const hasEnvKey = (apiKeyEnv: string): boolean => {
      const v = process.env[apiKeyEnv];
      return typeof v === 'string' && v.length > 0;
    };

    const list: ProviderInfo[] = [];

    for (const b of BUILTIN_PROVIDERS) {
      list.push({
        id: b.id,
        displayName: b.displayName,
        apiKeyEnv: b.apiKeyEnv,
        protocol: b.protocol,
        defaultModel: b.defaultModel,
        models: b.models ? [...b.models] : undefined,
        configured: keychainAccounts.has(b.id) || hasEnvKey(b.apiKeyEnv),
        isDefault: defaultId === b.id,
        isCustom: false,
      });
    }
    for (const c of providerConfigStore.listCustom()) {
      list.push({
        id: c.id,
        displayName: c.displayName,
        apiKeyEnv: c.apiKeyEnv,
        protocol: c.protocol,
        defaultModel: c.defaultModel,
        models: c.models ? [...c.models] : undefined,
        configured: keychainAccounts.has(c.id) || hasEnvKey(c.apiKeyEnv),
        isDefault: defaultId === c.id,
        isCustom: true,
        baseUrl: c.baseUrl,
      });
    }

    const keychainBackend = await getBackendStatus();
    return { providers: list, defaultProviderId: defaultId, keychainBackend };
  });

  // provider.setKey — renderer 把 key 推给 main 后立即写 keychain + 注入 env
  registerChannel('provider.setKey', async (input) => {
    if (!isBuiltinId(input.providerId) && !providerConfigStore.getCustom(input.providerId)) {
      // 未知 provider — 拒绝（防 LLM 诱导写 key 到任意 account 名占用 keychain 空间）
      throw new Error('unknown providerId');
    }
    // C2-sec：拒绝含 CRLF/NUL 的 key
    const keyErr = validateApiKey(input.apiKey);
    if (keyErr) throw new Error(keyErr);

    await setKey(input.providerId, input.apiKey);
    await injectSingleKey(input.providerId);
    return { ok: true };
  });

  // provider.removeKey
  registerChannel('provider.removeKey', async (input) => {
    const removed = await deleteKey(input.providerId);
    // 重新跑一遍全量注入——如果该 provider 跟其他共享 apiKeyEnv，
    // 删它的 key 之后那个 env 应回到另一个共享者的值（或被默认 provider 覆盖）
    await injectAllKeysToEnv();
    return { ok: removed };
  });

  // provider.test
  registerChannel('provider.test', async (input) => {
    await providerConfigStore.load();
    let probe;
    if (isBuiltinId(input.providerId)) {
      probe = getBuiltin(input.providerId);
    } else {
      probe = providerConfigStore.getCustom(input.providerId);
    }
    if (!probe) {
      return { ok: false, error: 'unknown provider' };
    }
    const apiKey = await getKey(input.providerId);
    if (!apiKey) {
      return { ok: false, error: 'no key configured' };
    }
    const result = await testProvider(probe, apiKey);
    return result;
  });

  // provider.setDefault
  registerChannel('provider.setDefault', async (input) => {
    if (!isBuiltinId(input.providerId) && !providerConfigStore.getCustom(input.providerId)) {
      throw new Error(`unknown providerId: ${input.providerId}`);
    }
    await providerConfigStore.setDefault(input.providerId);
    // 切默认 provider 时重新注入——共享 env 时让它胜出
    await injectAllKeysToEnv();
    return { ok: true };
  });

  // provider.addCustom
  //
  // 三道校验门：
  //   1) baseUrl 必须是 https://、不是 IP literal、hostname 不在内网黑名单（C1-sec SSRF）
  //   2) apiKeyEnv 是合法的 env var 名 + 不在 reserved blocklist（H2-sec NODE_OPTIONS 注入）
  //   3) displayName / defaultModel 由 schema 已经限了长度
  registerChannel('provider.addCustom', async (input) => {
    const urlCheck = validateBaseUrl(input.baseUrl);
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      throw new Error(`baseUrl rejected: ${urlCheck.error}`);
    }
    const envErr = validateApiKeyEnv(input.apiKeyEnv);
    if (envErr) throw new Error(envErr);

    const id = await providerConfigStore.addCustom({
      displayName: input.displayName,
      protocol: input.protocol,
      baseUrl: urlCheck.normalizedUrl,
      apiKeyEnv: input.apiKeyEnv,
      defaultModel: input.defaultModel,
      models: input.models,
    });
    return { ok: true, providerId: id };
  });

  // provider.removeCustom
  registerChannel('provider.removeCustom', async (input) => {
    const removed = await providerConfigStore.removeCustom(input.providerId);
    if (removed) {
      // 删 custom 时同步删 keychain 中的 key
      await deleteKey(input.providerId);
      await injectAllKeysToEnv();
    }
    return { ok: removed };
  });
}

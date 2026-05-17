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
import { setKey, deleteKey, getKey, listAccounts } from '../providers/keychain.js';
import { testProvider } from '../providers/test-connection.js';
import type { ProviderInfo } from '@kodax-space/space-ipc-schema';

/**
 * 把 keychain 中的 key 注入 process.env。
 *   - main 启动后调一次（载入所有已配置的 key）
 *   - setKey / removeKey 后实时增量更新 env
 *   - 注入策略：按 provider 的 apiKeyEnv（如 ANTHROPIC_API_KEY）。
 *     多个 provider 共享同一 apiKeyEnv（kimi + kimi-code 都用 KIMI_API_KEY）时，
 *     **默认 provider 的 key 胜出**——其他共享同 env 的 provider 用同一个值
 */
export async function injectAllKeysToEnv(): Promise<void> {
  await providerConfigStore.load();
  const accounts = await listAccounts();
  const defaultId = providerConfigStore.getDefaultProviderId();

  // 1) 先注入所有 account 的 key——多个 account 共用 env 时后写的覆盖
  for (const acct of accounts) {
    const info = resolveProviderInfo(acct);
    if (!info) continue;
    const value = await getKey(acct);
    if (value) process.env[info.apiKeyEnv] = value;
  }
  // 2) 默认 provider 的 key 最后注入一次——保证共享 env 时它胜出
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
    const configured = new Set(await listAccounts());
    const defaultId = providerConfigStore.getDefaultProviderId();

    const list: ProviderInfo[] = [];

    for (const b of BUILTIN_PROVIDERS) {
      list.push({
        id: b.id,
        displayName: b.displayName,
        apiKeyEnv: b.apiKeyEnv,
        protocol: b.protocol,
        defaultModel: b.defaultModel,
        models: b.models ? [...b.models] : undefined,
        configured: configured.has(b.id),
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
        configured: configured.has(c.id),
        isDefault: defaultId === c.id,
        isCustom: true,
        baseUrl: c.baseUrl,
      });
    }

    return { providers: list, defaultProviderId: defaultId };
  });

  // provider.setKey — renderer 把 key 推给 main 后立即写 keychain + 注入 env
  registerChannel('provider.setKey', async (input) => {
    if (!isBuiltinId(input.providerId) && !providerConfigStore.getCustom(input.providerId)) {
      // 未知 provider — 拒绝（防 LLM 诱导写 key 到任意 account 名占用 keychain 空间）
      throw new Error(`unknown providerId: ${input.providerId}`);
    }
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
  registerChannel('provider.addCustom', async (input) => {
    const id = await providerConfigStore.addCustom({
      displayName: input.displayName,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
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

// KodaX user-level config reader — v0.1.6 cleanup
//
// 读 ~/.kodax/config.json 的"非 mcpServers"字段，作为 Space 的 session 默认值来源：
//   - provider / model / thinking / reasoningMode / permissionMode → 新 session preselect
//   - customProviders → 通过 SDK registerConfiguredCustomProviders 注册到运行时 LLM registry，
//                       让 `/provider <name>` 直接可切（即使 Space Provider 面板不展示）
//
// 与 mcp/config-reader.ts 同套路：
//   - lazy load + DI（避开 tsx/esm cli-boxes JSON bug，让 test 跳过 SDK 加载）
//   - prewarm 在 main boot 阶段触发，不阻塞窗口
//
// **安全契约**：
//   - customProviders 数组永不离开 main（含 apiKeyEnv 字段是引用 env 变量名，但保守起见
//     不投影到 renderer）；只暴露 count
//   - 默认值是 string / boolean / enum 标量，无 secret 风险

// 不直接 import Space 的 PermissionMode（含 'auto'，KodaX 不会产生），改用窄子集。

type SdkRootModule = typeof import('@kodax-ai/kodax');
type SdkLoadConfigReturn = ReturnType<SdkRootModule['loadConfig']>;
type SdkCustomProviderConfig = NonNullable<SdkLoadConfigReturn['customProviders']>[number];

/** KodaX permissionMode 中能映射到 Space 的子集（'plan' / 'accept-edits'；其它 → undefined）。*/
type KodaxMappablePermissionMode = 'plan' | 'accept-edits';

/** Space 关心的子集 — schema 暴露给 renderer 时只露这些标量。 */
export interface KodaxUserDefaults {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: boolean;
  readonly reasoningMode?: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  readonly permissionMode?: KodaxMappablePermissionMode;
  /** customProviders 数量；具体配置不暴露给 renderer（SDK runtime 已注册可用）。*/
  readonly customProvidersCount: number;
}

export interface KodaxUserConfigImpl {
  /** SDK loadConfig — 返回完整 config 对象（main 端使用） */
  readonly loadConfig: () => SdkLoadConfigReturn;
  /** SDK registerConfiguredCustomProviders — 注册到运行时 LLM registry */
  readonly registerCustomProviders: (config: { customProviders?: SdkCustomProviderConfig[] }) => void;
}

let sdkModuleCache: SdkRootModule | null = null;
async function loadSdkRootModule(): Promise<SdkRootModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax');
  }
  return sdkModuleCache;
}

const DEFAULT_IMPL: KodaxUserConfigImpl = {
  loadConfig: () => {
    if (sdkModuleCache === null) {
      void loadSdkRootModule(); // trigger lazy load 不 await
      return {};
    }
    return sdkModuleCache.loadConfig();
  },
  registerCustomProviders: (config) => {
    if (sdkModuleCache === null) {
      void loadSdkRootModule();
      return; // 第一次冷调静默 skip，prewarm 后下次 OK
    }
    sdkModuleCache.registerConfiguredCustomProviders(config);
  },
};

let activeImpl: KodaxUserConfigImpl = DEFAULT_IMPL;

/** 测试用：注入 mock。 */
export function setUserConfigImpl(impl: KodaxUserConfigImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
}

/**
 * 启动期把 SDK chunk 拉热——让首次 IPC `kodax.getDefaults` 不命中空 fallback。
 * 失败不致命，下次调用时 lazy load 还会重试。
 */
export async function prewarmKodaxUserConfig(): Promise<void> {
  if (sdkModuleCache !== null) return;
  try {
    await loadSdkRootModule();
  } catch (err) {
    console.warn(
      '[kodax-user-config] prewarm failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 读 ~/.kodax/config.json 投影成 Space 的默认值子集。
 *
 * **冷启动同步化**：与 mcp/config-reader 同 — mock (test) short-circuit；生产首次调用
 * 必要时 await SDK chunk load，防 prewarm 还没完就被 IPC 命中。
 */
export async function loadKodaxUserDefaults(): Promise<KodaxUserDefaults> {
  // mock 注入 → 直接走；生产首调 await chunk
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      console.warn(
        '[kodax-user-config] SDK load failed in loadKodaxUserDefaults:',
        err instanceof Error ? err.message : err,
      );
      return { customProvidersCount: 0 };
    }
  }

  let raw: SdkLoadConfigReturn;
  try {
    raw = activeImpl.loadConfig();
  } catch (err) {
    // SDK loadConfig 不应抛（损坏的 config.json SDK 自己 fallback {}），但保守 try/catch
    console.warn(
      '[kodax-user-config] SDK loadConfig threw:',
      err instanceof Error ? err.message : err,
    );
    return { customProvidersCount: 0 };
  }

  // reasoningCeiling 是 v0.7.29 后的 preferred name；reasoningMode 是旧名。
  // 都映射到同一 Space 字段，preferred wins。
  const reasoningRaw = raw.reasoningCeiling ?? raw.reasoningMode;
  const reasoningMode = normalizeReasoningMode(reasoningRaw);

  return {
    provider: typeof raw.provider === 'string' && raw.provider.length > 0 ? raw.provider : undefined,
    model: typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : undefined,
    thinking: typeof raw.thinking === 'boolean' ? raw.thinking : undefined,
    reasoningMode,
    permissionMode: normalizePermissionMode(raw.permissionMode),
    customProvidersCount: Array.isArray(raw.customProviders) ? raw.customProviders.length : 0,
  };
}

/**
 * Boot 时调一次，把 KodaX config 的 customProviders 注册到 SDK 运行时 LLM registry。
 * 注册后 `/provider <name>` 能直接切到 KodaX-CLI 配的自定义 provider（如 newapi-anthropic）。
 *
 * **失败不阻塞启动**——customProviders 不可用最多让用户没法用那几个 provider，built-in 仍 OK。
 * **不打印 customProviders 详情**——apiKeyEnv 是变量名不是值，但保守起见只 log count。
 */
export async function registerKodaxCustomProviders(): Promise<void> {
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkRootModule();
    } catch (err) {
      console.warn(
        '[kodax-user-config] SDK load failed in registerKodaxCustomProviders:',
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }

  let raw: SdkLoadConfigReturn;
  try {
    raw = activeImpl.loadConfig();
  } catch (err) {
    console.warn(
      '[kodax-user-config] SDK loadConfig threw in registerCustomProviders:',
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const customProviders = Array.isArray(raw.customProviders) ? raw.customProviders : undefined;
  if (!customProviders || customProviders.length === 0) return;

  try {
    activeImpl.registerCustomProviders({ customProviders });
    console.info(
      `[kodax-user-config] registered ${customProviders.length} custom provider(s) from ~/.kodax/config.json`,
    );
  } catch (err) {
    console.warn(
      '[kodax-user-config] registerConfiguredCustomProviders threw:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ---- helpers ----

/** SDK 可能返回 string 标记的 reasoningMode；mapped 到 Space 的 union；其它值丢弃。*/
function normalizeReasoningMode(
  v: unknown,
): KodaxUserDefaults['reasoningMode'] {
  if (typeof v !== 'string') return undefined;
  const allowed = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
  return (allowed as readonly string[]).includes(v)
    ? (v as KodaxUserDefaults['reasoningMode'])
    : undefined;
}

/**
 * KodaX permissionMode (string) → Space PermissionMode union。
 *
 * KodaX 0.7.x 合法值：'plan' | 'default' | 'accept-edits' | 'bypass-permissions'
 * Space 合法值：     'plan' | 'accept-edits' | 'auto'
 *
 * 1:1 直接映射的只有 'plan' / 'accept-edits'。'default' / 'bypass-permissions' 没有
 * 直接对应——Space 用 'auto' + auto-rules.jsonc 模拟 bypass，'default' 是 KodaX 早期
 * 模式 Space 不复刻。返回 undefined 让 renderer 走 Space schema default ('accept-edits')。
 */
function normalizePermissionMode(v: unknown): KodaxMappablePermissionMode | undefined {
  if (typeof v !== 'string') return undefined;
  if (v === 'plan' || v === 'accept-edits') return v;
  return undefined;
}

// SDK Provider snapshot bridge — alpha.1
//
// KodaX 0.7.42 起从主 export 暴露：
//   - `KODAX_PROVIDER_SNAPSHOTS`     全部 provider snapshot（含 apiKeyEnv / model / models / capabilityProfile）
//   - `getProviderModels(name)`       该 provider 的 variant 列表（不含 default）
//   - `getProviderModel(name)`        该 provider 的默认 model
//
// catalog.ts 之前是 v0.7.40 时的硬编码 snapshot，落后于 SDK；改成 list handler 在拼
// ProviderInfo 时调本模块"覆盖" defaultModel + models。catalog.ts 只保留 Space 自己的
// 元数据 (displayName / protocol / testEndpoint)。
//
// SDK 是 ESM，main bundle 是 CJS — 必须 dynamic import + cache，否则 require 会撞
// ERR_PACKAGE_PATH_NOT_EXPORTED。第一次 await 后后续零成本。

type SdkRootModule = typeof import('@kodax-ai/kodax');
let sdkCache: SdkRootModule | null = null;

async function loadSdk(): Promise<SdkRootModule> {
  if (sdkCache === null) {
    sdkCache = await import('@kodax-ai/kodax');
  }
  return sdkCache;
}

export interface KodaxProviderModelInfo {
  readonly defaultModel: string;
  /** Variant models 列表 — 已包含 defaultModel（拼接顺序：default 在前）。*/
  readonly models: readonly string[];
}

/**
 * 取某 provider 的 default model + 全 model 列表（包含 default）。
 *
 * 若 SDK 不识别该 provider id（custom provider / id 拼错），返回 null —
 * 调用方应当用 catalog 的 fallback 值。
 */
export async function getKodaxProviderModelsAndDefault(
  providerId: string,
): Promise<KodaxProviderModelInfo | null> {
  try {
    const sdk = await loadSdk();
    const snap = sdk.KODAX_PROVIDER_SNAPSHOTS[providerId as keyof typeof sdk.KODAX_PROVIDER_SNAPSHOTS];
    if (!snap) return null;
    const defaultModel = snap.model;
    // SDK 的 models[] 不含 default — 拼到开头让 UI 直接遍历就有 default 在第一位
    const variants = sdk.getProviderModels(providerId) ?? snap.models ?? [];
    const models = [defaultModel, ...variants.filter((m) => m !== defaultModel)];
    return { defaultModel, models };
  } catch (err) {
    console.warn(`[sdk-providers] failed to load models for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

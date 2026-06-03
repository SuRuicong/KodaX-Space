// Test connection — FEATURE_004，FEATURE_216 (SDK 0.7.45) 起改走 SDK。
//
// 验证 API key 对 provider 是否有效。**走 SDK `verifyProviderCredential`**，不再手写
// HTTP probe —— 与实际对话/coding 调用同源（SDK 按 provider-capabilities.json 的
// verifyStrategy 自动选 count-tokens / models-list / minimal-message），消除「测连接 vs
// 实际调用」双实现漂移：SDK 新增 provider 时 Space 零改动自动跟上。
//
// 成本：多数 provider 走 count-tokens / models-list = 0 token；zhipu / mimo / mimo-coding
// 走 minimal-message ≈ 6-7 token（SDK 侧 count-tokens 对它们返 404 才退化到此）。
//
// 凭证：SDK 从 `process.env[apiKeyEnv]` 读（main 启动期 injectAllKeysToEnv 注入；setKey
// 时 injectSingleKey 保持同步）。env 缺失 → SDK 返 error:'unconfigured'（never-throws，不崩）。
//
// 错误脱敏：apiKey 不再经过本模块——SDK 自己从 env 取，物理上不可见。

import type { BuiltinProvider } from './catalog.js';
import type { CustomProvider } from './config.js';
import { validateBaseUrl } from './url-guard.js';

type Probe = BuiltinProvider | CustomProvider;

export interface TestResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

interface VerifyOpts {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

// SDK /llm 走真实 d.ts（ambient kodax-sdk-types.d.ts 不声明 /llm，真实 sdk-llm.d.ts 提供
// verifyProviderCredential / createCustomProvider / KodaXVerifyCredentialResult）。
type SdkLlm = typeof import('@kodax-ai/kodax/llm');
/** 测连接只用到 SDK 的这两个 API；导出供测试用 deps 注入。*/
export type TestProviderModule = Pick<SdkLlm, 'verifyProviderCredential' | 'createCustomProvider'>;

type VerifyResult = Awaited<ReturnType<SdkLlm['verifyProviderCredential']>>;

const DEFAULT_TIMEOUT_MS = 8000;

// 模块级 lazy-import cache —— 仿 real-session.ts loadSdkLlm。
// **dynamic import**：SDK subpath 只声明 ESM "import" 条件，CJS-built main 静态 require 会撞
// ERR_PACKAGE_PATH_NOT_EXPORTED。失败的 promise 留 cache 返 null，不反复重试。
let sdkLlmCache: Promise<TestProviderModule | null> | null = null;
function loadSdkLlm(): Promise<TestProviderModule | null> {
  if (sdkLlmCache === null) {
    sdkLlmCache = import('@kodax-ai/kodax/llm').catch((err) => {
      console.warn(
        `[test-connection] failed to load @kodax-ai/kodax/llm: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    });
  }
  return sdkLlmCache;
}

function mapSdkError(error: VerifyResult['error']): string {
  switch (error) {
    case 'unauthorized':
      return 'unauthorized (check API key)';
    case 'network':
      return 'network error';
    case 'timeout':
      return 'timeout';
    case 'unsupported':
      return 'provider does not support connection test';
    case 'unconfigured':
      return 'no API key configured';
    case 'server_error':
      return 'server error';
    case 'rate_limited':
      return 'rate limited (try again later)';
    default:
      return 'unknown error';
  }
}

function toResult(r: VerifyResult): TestResult {
  if (r.ok) return { ok: true, latencyMs: r.durationMs };
  return { ok: false, latencyMs: r.durationMs, error: mapSdkError(r.error) };
}

/**
 * 用 env 里的 key 探测一次 provider，结果用于 UI 绿/红状态。
 *
 * @param deps  测试注入：`undefined` = 真实 lazy import；`null` = 模拟 SDK 不可用降级。
 *
 * builtin → `verifyProviderCredential(id)`。
 * custom（Space `custom_*` 不在 SDK runtime registry）→ `createCustomProvider(config).verifyCredential()`。
 */
export async function testProvider(
  provider: Probe,
  opts?: VerifyOpts,
  deps?: TestProviderModule | null,
): Promise<TestResult> {
  const sdk = deps === undefined ? await loadSdkLlm() : deps;
  if (sdk === null) {
    return { ok: false, error: 'SDK unavailable (try restarting)' };
  }

  const verifyOpts: VerifyOpts = {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts?.signal,
  };

  // custom provider：BuiltinProvider 无 baseUrl，用它区分。
  if ('baseUrl' in provider) {
    // SSRF defense-in-depth：custom-providers.json 可能被外部进程篡改成内网 / metadata URL
    //（如 http://169.254.169.254）。addCustom 时已 validateBaseUrl，这里运行前再 double-check——
    // baseUrl 会带着 env 里的 API key 真发请求，篡改后果是 key 泄露给攻击者端点。
    const urlCheck = validateBaseUrl(provider.baseUrl);
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return { ok: false, error: `invalid baseUrl: ${urlCheck.error ?? 'validation failed'}` };
    }
    let instance: ReturnType<TestProviderModule['createCustomProvider']>;
    try {
      instance = sdk.createCustomProvider({
        name: provider.id,
        protocol: provider.protocol,
        baseUrl: urlCheck.normalizedUrl,
        apiKeyEnv: provider.apiKeyEnv,
        model: provider.defaultModel,
        models: provider.models ? [...provider.models] : undefined,
      });
    } catch {
      // 不回传 err.message —— SDK 的 validateCustomProviderConfig 错误可能含 apiKeyEnv 名等配置字段。
      return { ok: false, error: 'invalid custom provider config' };
    }
    return toResult(await instance.verifyCredential(verifyOpts));
  }

  return toResult(await sdk.verifyProviderCredential(provider.id, verifyOpts));
}

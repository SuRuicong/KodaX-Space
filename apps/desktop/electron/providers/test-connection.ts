// Test connection — FEATURE_004
//
// 验证 API key 对 provider 有效。**不**真发 LLM completion——
//   - 烧 token 不合适（每次测都几百字符）
//   - 不同 provider 最小调用形式不一致
//
// 改用"最小 HTTP probe"：
//   - openai 协议：GET /v1/models with Bearer <key>  → 200 = OK
//   - anthropic 协议：POST /v1/messages 最小 payload  → 401 = bad key, 200/400 = key OK
//     （400 通常是 model 名不对，不影响 key 验证；只要不是 401/403 都算 key OK）
//   - gemini-cli / codex-cli：跳过——CLI bridge 没有 HTTP endpoint
//
// 返回结构：
//   { ok: true, latencyMs }     —— key 有效
//   { ok: false, error: '...' } —— 短描述：'unauthorized' / 'network error' / 'not_supported'
//
// 错误信息脱敏：永不回传 HTTP body（可能含 key 回显）；只回 status code 类别
// + 一行人话描述

import type { BuiltinProvider } from './catalog.js';
import type { CustomProvider } from './config.js';

type Probe = BuiltinProvider | CustomProvider;

interface TestResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

const TIMEOUT_MS = 8000;

/**
 * 用 key 探测一次 provider，结果用于 UI 显示绿/红状态。
 *
 * 注意（review 安全）：apiKey 是敏感数据——本函数只把它放进 Authorization header，
 * 永不写日志、永不进 error message、永不返回给上层。失败时只回类别化错误。
 */
export async function testProvider(provider: Probe, apiKey: string): Promise<TestResult> {
  const protocol = provider.protocol;
  const endpoint = pickEndpoint(provider);
  if (!endpoint) {
    return { ok: false, error: 'CLI bridge providers do not support HTTP probe' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();

  try {
    let response: Response;
    if (protocol === 'openai') {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'user-agent': 'kodax-space/0.1.0',
        },
        signal: controller.signal,
      });
    } else if (protocol === 'anthropic') {
      // Anthropic-compat /v1/messages 最小 payload——model 字段填 provider 的 defaultModel；
      // 即便 model 名不被服务端识别（返回 400），只要不是 401/403 就说明 key 通过认证
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'user-agent': 'kodax-space/0.1.0',
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: controller.signal,
      });
    } else {
      return { ok: false, error: 'CLI bridge providers do not support HTTP probe' };
    }

    const latencyMs = Date.now() - t0;
    if (response.status === 401 || response.status === 403) {
      return { ok: false, latencyMs, error: 'unauthorized (check API key)' };
    }
    if (response.status >= 500) {
      return { ok: false, latencyMs, error: `server error (HTTP ${response.status})` };
    }
    // 200~499（除 401/403）都算 key 通过认证——4xx 通常是 model 名 / payload 不对
    // 不影响 key 验证目的
    return { ok: true, latencyMs };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') return { ok: false, error: 'timeout (8s)' };
      // 其他 fetch 错误（DNS / TLS / connection refused）——一律归网络错误
      return { ok: false, error: 'network error' };
    }
    return { ok: false, error: 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

function pickEndpoint(provider: Probe): string | undefined {
  // BuiltinProvider 的 testEndpoint 字段在 catalog 里硬编码
  if ('testEndpoint' in provider && provider.testEndpoint) return provider.testEndpoint;
  // CustomProvider 没有显式 testEndpoint——用 baseUrl + protocol 标准 path 拼
  if ('baseUrl' in provider) {
    const base = provider.baseUrl.replace(/\/$/, '');
    if (provider.protocol === 'openai') return `${base}/models`;
    if (provider.protocol === 'anthropic') return `${base}/messages`;
  }
  return undefined;
}

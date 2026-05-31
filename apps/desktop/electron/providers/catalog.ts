// Built-in provider catalog —— **薄适配层**
//
// 数据来源拆分（单一事实源原则）：
//   • SDK 单一来源：直接读 `@kodax-ai/kodax/dist/provider-capabilities.json`
//     —— KodaX 在 build 时把 packages/llm 的 capability JSON copy 到顶层 dist。
//     拉 apiKeyEnv / defaultModel / models[]，不再手 copy 一份 snapshot 到 Space 里。
//     之前 (v0.7.40 snapshot) 手 copy 导致 KodaX 改了 env 名 Space 不知道，必须人工 sync；
//     现在 KodaX 改 → Space 自动跟上。
//   • Space override (本文件 SPACE_OVERRIDES)：displayName / testEndpoint / protocol —— 纯 UI / 测连接元数据
//     SDK 不关心这些（KodaX 用 `capabilityProfile` 表达更丰富的能力，Space 暂时只用一个
//     四值 protocol 标识"测连接走啥协议"）。
//
// 为什么不 dynamic-import @kodax-ai/kodax 读 KODAX_PROVIDER_SNAPSHOTS：
//   1. JSON 直读是 SYNC 的，catalog 可以保持模块顶层 const 不需要 init step。
//   2. 加载整个 SDK runtime 仅为读 13 条 provider 数据是巨大浪费 (transitive deps 几十个)。
//   3. tsx/esm 测试环境下 SDK 全量加载有 cli-boxes 等深层 dep 解析问题；JSON 直读绕开。
//
// 与 SDK 的 schema 对齐：JSON 的 `models[]` 是 `{ id, displayName, ... }` 对象数组，
// 这里映射成 string[] (只取 id) 给 UI 用。

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ProviderProtocol } from '@kodax-space/space-ipc-schema';

export interface BuiltinProvider {
  readonly id: string;
  readonly displayName: string;
  readonly apiKeyEnv: string;
  readonly protocol: ProviderProtocol;
  /** Test connection 用的 GET endpoint（包含完整 URL）；undefined → 跳过 HTTP probe。*/
  readonly testEndpoint?: string;
  readonly defaultModel: string;
  readonly models?: readonly string[];
}

/**
 * Space-only override：SDK 不提供的 UI / 测连接元数据。
 * id 必须与 SDK provider-capabilities.json key 一致。
 *
 * SDK 增加新 provider 时本表没条目 → 自动用兜底 displayName=id + protocol='openai' +
 * 无 testEndpoint，并打 warn 提醒补 override（让 UI 显示更友好）。
 */
interface SpaceOverride {
  readonly displayName: string;
  readonly protocol: ProviderProtocol;
  readonly testEndpoint?: string;
  /**
   * JSON 没 model 字段时的兜底（CLI bridge provider 用 —— KodaX SDK runtime 调
   * `getCodexCliDefaultModel()` 等动态填，JSON 里是空的）。
   */
  readonly defaultModelFallback?: string;
}

const SPACE_OVERRIDES: Record<string, SpaceOverride> = {
  anthropic: {
    displayName: 'Anthropic',
    protocol: 'anthropic',
    testEndpoint: 'https://api.anthropic.com/v1/models',
  },
  openai: {
    displayName: 'OpenAI',
    protocol: 'openai',
    testEndpoint: 'https://api.openai.com/v1/models',
  },
  deepseek: {
    displayName: 'DeepSeek',
    protocol: 'openai',
    testEndpoint: 'https://api.deepseek.com/v1/models',
  },
  kimi: {
    displayName: 'Kimi (Moonshot)',
    protocol: 'openai',
    testEndpoint: 'https://api.moonshot.cn/v1/models',
  },
  'kimi-code': {
    displayName: 'Kimi for Coding',
    protocol: 'anthropic',
    // Anthropic-compat 端点；test-connection.ts 走 POST minimal completion 不依赖 GET /v1/models
    testEndpoint: 'https://api.moonshot.cn/anthropic/v1/messages',
  },
  qwen: {
    displayName: 'Qwen (Alibaba)',
    protocol: 'openai',
    testEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  },
  zhipu: {
    displayName: 'Zhipu (BigModel)',
    protocol: 'openai',
    testEndpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
  },
  'zhipu-coding': {
    displayName: 'Zhipu Coding Plan',
    protocol: 'anthropic',
    testEndpoint: 'https://open.bigmodel.cn/api/anthropic/v1/messages',
  },
  'minimax-coding': {
    displayName: 'MiniMax Coding',
    protocol: 'anthropic',
    testEndpoint: 'https://api.minimax.chat/v1/messages',
  },
  'mimo-coding': {
    displayName: 'MiMo (Xiaomi)',
    protocol: 'anthropic',
    testEndpoint: 'https://api.xiaomi.com/mimo/anthropic/v1/messages',
  },
  'ark-coding': {
    displayName: 'Volcengine Ark Coding',
    protocol: 'anthropic',
    testEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/messages',
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    protocol: 'gemini-cli',
    // CLI bridge — no HTTP probe applicable；defaultModel 由本地 gemini CLI 自报
    defaultModelFallback: 'gemini-3.0-pro',
  },
  'codex-cli': {
    displayName: 'Codex CLI (OpenAI)',
    protocol: 'codex-cli',
    // CLI bridge — no HTTP probe applicable；defaultModel 由本地 codex CLI 自报
    defaultModelFallback: 'gpt-5.3-codex',
  },
};

// ---- 读 SDK JSON 单一事实源 ----

// JSON 形态：
//   {
//     version: 1,
//     updatedAt: 'YYYY-MM-DD',
//     providers: {
//       [id: string]: {
//         apiKeyEnv: string,
//         model: string,
//         models?: Array<{ id: string, displayName?: string, ... }>,
//         ...
//       }
//     }
//   }
interface CapabilityJsonEntry {
  readonly apiKeyEnv: string;
  /** CLI bridge provider 没此字段；其他都有。*/
  readonly model?: string;
  readonly models?: ReadonlyArray<{ readonly id: string }>;
}
interface CapabilityJson {
  readonly version: number;
  readonly providers: Readonly<Record<string, CapabilityJsonEntry>>;
}

function resolveCapabilityJsonPath(): string {
  // require.resolve('@kodax-ai/kodax/package.json') 在 exports map 里显式列了，
  // 永远可解析；从那里推 sibling dist/provider-capabilities.json 路径稳定。
  // ESM 没 require —— createRequire(import.meta.url) 通用兼容，main build (CJS) 也吃得下。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (typeof require !== 'undefined' ? null : (import.meta as any));
  const req = meta ? createRequire(meta.url) : require;
  const pkgPath = req.resolve('@kodax-ai/kodax/package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'provider-capabilities.json');
}

function loadProvidersFromJson(): readonly BuiltinProvider[] {
  const jsonPath = resolveCapabilityJsonPath();
  const raw = readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as CapabilityJson;
  if (parsed.version !== 1) {
    // 不抛 —— 仍尝试按 v1 shape 解析。若 KodaX 真的 bump 到 v2 且字段不兼容，
    // 这里会在下面 forEach 里因字段缺失抛出更具体的错误。
    console.warn(
      `[catalog] provider-capabilities.json version=${parsed.version}, expected 1 — `
      + `Space catalog may need a sync with KodaX schema changes`,
    );
  }
  const list: BuiltinProvider[] = [];
  for (const [id, entry] of Object.entries(parsed.providers)) {
    const ov = SPACE_OVERRIDES[id];
    if (!ov) {
      console.warn(
        `[catalog] SDK provider '${id}' has no Space override; using fallback `
        + `displayName/protocol. Add an entry to SPACE_OVERRIDES in catalog.ts.`,
      );
    }
    // entry.model 缺失时（CLI bridge）走 Space override fallback；都没有则用 id 兜底
    const defaultModel = entry.model ?? ov?.defaultModelFallback ?? id;
    // JSON 的 models[] 不含 default — 拼到开头让 UI 直接遍历就有 default 在第一位
    const variants = (entry.models ?? []).map((m) => m.id);
    const models = [defaultModel, ...variants.filter((m) => m !== defaultModel)];
    list.push({
      id,
      displayName: ov?.displayName ?? id,
      apiKeyEnv: entry.apiKeyEnv,
      protocol: ov?.protocol ?? 'openai',
      testEndpoint: ov?.testEndpoint,
      defaultModel,
      models,
    });
  }
  return list;
}

// 模块顶层一次性 load —— 失败就抛，让 main 启动期 fail-fast 而不是静默 fallback 到空。
// 启动后 catalog 数据 immutable，重新 hot-reload Space 进程才会重读 (KodaX 升 SDK 时
// 用户重启 Space 自然吃到新 catalog)。
export const BUILTIN_PROVIDERS: readonly BuiltinProvider[] = loadProvidersFromJson();

export function getBuiltin(id: string): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

export function isBuiltinId(id: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.id === id);
}

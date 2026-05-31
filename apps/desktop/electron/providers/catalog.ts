// Built-in provider catalog — FEATURE_004
//
// 来源：snapshot from KodaX `packages/llm/src/providers/provider-capabilities.json`
// (sync 至 2026-05-25 KodaX 本地 npm-link 版本).
// 等 `@kodax-ai/llm` 发到 npm 后这里改成 `import { KODAX_PROVIDER_SNAPSHOTS }`，
// 保留 catalog.ts 作为薄适配层（map 到 Space 的 ProviderInfo shape）。
//
// 同步策略：
//   - KodaX 升级时手动 sync 本文件（增删 provider / 改 default model）
//   - apiKeyEnv 必须与 KodaX 端完全一致——main 启动时按这个 env var 名注入 keychain key，
//     LLM SDK 通过同一个 env 读 key
//
// 2026-05-31 sync：KodaX 把 5 个 coding-plan provider 的 env 名从"和普通版共享"改成独立后缀，
// 让用户能给"普通 API"和"coding plan"配不同的 key (这俩是不同的计费 endpoint)：
//   kimi-code:      KIMI_API_KEY     → KIMI_CODE_API_KEY
//   zhipu-coding:   ZHIPU_API_KEY    → ZHIPU_CODING_API_KEY
//   minimax-coding: MINIMAX_API_KEY  → MINIMAX_CODING_API_KEY
//   mimo-coding:    MIMO_API_KEY     → MIMO_CODING_API_KEY
//   ark-coding:     ARK_API_KEY      → ARK_CODING_API_KEY
// keychain 数据无需迁移 (account=providerId 不变)；shell-export 的 legacy env 名用户
// 需手动加一条新名。
//
// 字段说明：
//   - id          稳定标识符（不要变；keychain account 名按此存）
//   - displayName UI 用
//   - apiKeyEnv   `process.env[apiKeyEnv]` 是 SDK 读 key 的入口
//   - protocol    SDK 协议族——决定 test connection 调哪个 endpoint shape
//   - testEndpoint 测连接用的 GET endpoint（minimal probe）；undefined 表示这个 provider
//                 不支持 HTTP probe（如 CLI bridge），跳过测试
//   - defaultModel + models KodaX SDK 的默认模型 + 可选模型列表

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

export const BUILTIN_PROVIDERS: readonly BuiltinProvider[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    protocol: 'anthropic',
    testEndpoint: 'https://api.anthropic.com/v1/models',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: 'openai',
    testEndpoint: 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-5.3-codex',
    models: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    protocol: 'openai',
    testEndpoint: 'https://api.deepseek.com/v1/models',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'kimi',
    displayName: 'Kimi (Moonshot)',
    apiKeyEnv: 'KIMI_API_KEY',
    protocol: 'openai',
    testEndpoint: 'https://api.moonshot.cn/v1/models',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'k2.5'],
  },
  {
    id: 'kimi-code',
    displayName: 'Kimi for Coding',
    apiKeyEnv: 'KIMI_CODE_API_KEY',
    protocol: 'anthropic',
    // Kimi-for-Coding 的 endpoint 是 Anthropic-compat 但不暴露 /v1/models GET；
    // 测连接走 POST minimal completion——见 test-connection.ts。这里仍标 testEndpoint
    // 让 ProviderHandler 知道"我有 HTTP probe path"，但实际请求方式由 protocol 决定。
    testEndpoint: 'https://api.moonshot.cn/anthropic/v1/messages',
    defaultModel: 'kimi-for-coding',
  },
  {
    id: 'qwen',
    displayName: 'Qwen (Alibaba)',
    apiKeyEnv: 'QWEN_API_KEY',
    protocol: 'openai',
    testEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    defaultModel: 'qwen3.5-plus',
  },
  {
    id: 'zhipu',
    displayName: 'Zhipu (BigModel)',
    apiKeyEnv: 'ZHIPU_API_KEY',
    protocol: 'openai',
    testEndpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5.1', 'glm-5-turbo'],
  },
  {
    id: 'zhipu-coding',
    displayName: 'Zhipu Coding Plan',
    apiKeyEnv: 'ZHIPU_CODING_API_KEY',
    protocol: 'anthropic',
    testEndpoint: 'https://open.bigmodel.cn/api/anthropic/v1/messages',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5.1', 'glm-5-turbo'],
  },
  {
    id: 'minimax-coding',
    displayName: 'MiniMax Coding',
    apiKeyEnv: 'MINIMAX_CODING_API_KEY',
    protocol: 'anthropic',
    testEndpoint: 'https://api.minimax.chat/v1/messages',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
  },
  {
    id: 'mimo-coding',
    displayName: 'MiMo (Xiaomi)',
    apiKeyEnv: 'MIMO_CODING_API_KEY',
    protocol: 'anthropic',
    testEndpoint: 'https://api.xiaomi.com/mimo/anthropic/v1/messages',
    defaultModel: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
  },
  {
    id: 'ark-coding',
    displayName: 'Volcengine Ark Coding',
    apiKeyEnv: 'ARK_CODING_API_KEY',
    protocol: 'anthropic',
    testEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/messages',
    defaultModel: 'glm-5.1',
    models: ['glm-5.1', 'glm-4.7', 'kimi-k2.6', 'minimax-latest', 'deepseek-v3.2'],
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    apiKeyEnv: 'GEMINI_API_KEY',
    protocol: 'gemini-cli',
    // CLI bridge — no HTTP probe applicable
    defaultModel: 'gemini-3.0-pro',
  },
  {
    id: 'codex-cli',
    displayName: 'Codex CLI (OpenAI)',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: 'codex-cli',
    // CLI bridge — no HTTP probe applicable
    defaultModel: 'gpt-5.3-codex',
  },
];

export function getBuiltin(id: string): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

export function isBuiltinId(id: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.id === id);
}

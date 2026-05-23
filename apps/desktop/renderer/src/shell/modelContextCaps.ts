// Per-model context window caps — alpha.1
//
// SDK 0.7.42 暂未在 KODAX_PROVIDER_SNAPSHOTS 暴露 contextWindow 字段，本表是
// renderer 端的 patch 层，按 model 名前缀匹配。等 SDK 出 contextWindow 后这里改成
// 直接从 ProviderInfo / snapshot 读，删掉硬编码表。
//
// 数据来源：各 provider 官方文档（截至 2026-05），保守取主流值。**未列出的 model 不假装
// 1M**——之前硬编码 1M cap 给用户错误的"还有大把空间"信号；保守 fallback 改 200k。

type CapRule = { match: RegExp; cap: number };

const RULES: readonly CapRule[] = [
  // Anthropic Claude — 200k 上下文
  { match: /^claude-/, cap: 200_000 },
  // OpenAI GPT-5 系列 — 1M (GPT-5.4 / GPT-5.3-codex / spark)
  { match: /^gpt-5/, cap: 1_000_000 },
  // OpenAI GPT-4 系列 — 128k
  { match: /^gpt-4/, cap: 128_000 },
  // DeepSeek v3 / v4 系列 — 128k
  { match: /^deepseek-v[34]/, cap: 128_000 },
  // Kimi K2 系列 — 200k
  { match: /^kimi-k2/, cap: 200_000 },
  // Kimi for Coding — 200k (沿用 K2 默认窗口)
  { match: /^kimi-for-coding/, cap: 200_000 },
  // Qwen 3.5 — 1M
  { match: /^qwen3\.5/, cap: 1_000_000 },
  // GLM-5 系列 — 200k (BigModel / Zhipu Coding Plan 同款上下文)
  { match: /^glm-5/, cap: 200_000 },
  // GLM-4.7 — 128k
  { match: /^glm-4\.7/, cap: 128_000 },
  // MiniMax M2 系列 — 1M
  { match: /^MiniMax-M2/, cap: 1_000_000 },
  // MiniMax latest (ark-coding 中) — 1M
  { match: /^minimax-latest/, cap: 1_000_000 },
  // MiMo (Xiaomi) — 128k
  { match: /^mimo-/, cap: 128_000 },
  // Doubao seed 2.0 系列 (ark-coding) — 256k
  { match: /^doubao-seed/, cap: 256_000 },
  // Gemini 3 — 2M
  { match: /^gemini-3/, cap: 2_000_000 },
];

/** Fallback 上下文窗口 — 用于没匹配上规则的 model。保守取 200k 避免误导。*/
export const DEFAULT_CONTEXT_CAP = 200_000;

/**
 * 按 model 名解析上下文窗口。匹配第一条规则的 cap；都不匹配返回 DEFAULT_CONTEXT_CAP.
 * model 为空 / undefined → fallback.
 */
export function getModelContextCap(model: string | undefined | null): number {
  if (!model) return DEFAULT_CONTEXT_CAP;
  for (const rule of RULES) {
    if (rule.match.test(model)) return rule.cap;
  }
  return DEFAULT_CONTEXT_CAP;
}

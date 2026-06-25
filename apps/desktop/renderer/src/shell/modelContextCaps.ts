// Per-model context window caps — fallback only (alpha.2)
//
// 主入口已切到 SDK driven 的 IPC `provider.modelContextWindow`（走 resolveContextWindow 的
// 四步级联），与 SDK runtime 决定 compaction 触发的算法完全同源。本表只在以下情况兜底：
//   - 初次 mount IPC 未返回前（UI 同步首帧避免空窗）
//   - 渲染进程拿不到 window.kodaxSpace（preload 异常）
//   - IPC 失败 / SDK 不识别 provider id（custom_*）
//
// 数据来源：各 provider 官方文档（截至 2026-05），保守取主流值。**未列出的 model 不假装
// 1M**——之前硬编码 1M cap 给用户错误的"还有大把空间"信号；保守 fallback 改 200k。
// 长期目标：等 SDK 全 provider 都接好 getEffectiveContextWindow 后整张表可删。

type CapRule = { match: RegExp; cap: number };

const RULES: readonly CapRule[] = [
  // Anthropic Claude — 200k 上下文
  { match: /^claude-/, cap: 200_000 },
  // OpenAI GPT-5 系列 — 1M (GPT-5.4 / GPT-5.3-codex / spark)
  { match: /^gpt-5/, cap: 1_000_000 },
  // OpenAI GPT-4 系列 — 128k
  { match: /^gpt-4/, cap: 128_000 },
  // DeepSeek V3 / V4 — 1M（DeepSeek API 当前所有 model 统一 1M context window，
  // 经 resolveContextWindow 验证 deepseek-v3.2 / v4-pro 都返回 1M）
  { match: /^deepseek-/, cap: 1_000_000 },
  // Kimi K2.7 Code — 256k (KodaX 0.7.56, kimi + ark-coding).
  { match: /^kimi-k2\.7-code$/, cap: 256_000 },
  // Kimi K2 series fallback — 200k.
  { match: /^kimi-k2/, cap: 200_000 },
  // Kimi for Coding — 256k（SDK 实际值；之前硬编码 200k 偏低）
  { match: /^kimi-for-coding/, cap: 256_000 },
  // Qwen 3.5 — 1M
  { match: /^qwen3\.5/, cap: 1_000_000 },
  // GLM-5.2 (Zhipu Coding Plan) - 1M; keep this before the broader GLM-5 fallback.
  { match: /^glm-5\.2$/, cap: 1_000_000 },
  // GLM-5 / GLM-5.1 / GLM-5 Turbo - 200k fallback.
  { match: /^glm-5(?:$|\.1$|-turbo$)/, cap: 200_000 },
  // GLM-4.7 - 200k.
  { match: /^glm-4\.7$/, cap: 200_000 },
  // MiniMax M 系列 (M2 / M2.7 / M3，ark-coding + minimax-coding) — 1M
  // 2026-06-09 SDK ark-coding 阵容 catch-up：新增 MiniMax-M3、移除 minimax-latest，
  // 故 match 从 /^MiniMax-M2/ 放宽到 /^MiniMax-M/ 覆盖 M3 及后续，并删掉死规则 minimax-latest。
  { match: /^MiniMax-M/, cap: 1_000_000 },
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

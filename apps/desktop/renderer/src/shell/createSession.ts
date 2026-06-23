// 创建 session 的共享逻辑 — F011-revised
//
// 两处调用：
//   1. LeftSidebar "+ New session" 显式按钮
//   2. BottomBar 用户没选 session 直接打字 → 自动创建
//
// Provider 选择优先级（高→低）：
//   1. pendingProviderId — 用户在无 session 时通过 ModelEffortSelector 选的 provider
//   2. defaultProviderId — Space 用户自己设的默认 (Settings 里的 Default)
//   3. kodaxDefaults.provider — ~/.kodax/config.json 写的 provider
//   4. 第一个 configured 的非 mock provider — 兜底友好选择
//   5. 'mock' — 最终保底，保证总能创建 session
//
// 但若候选 provider !configured，会跳过它继续往下找——避免 "选了 ark-coding 但 ARK_API_KEY
// 不在 env" 时 session.create 拿到不可用 provider 直接 fail。
//
// reasoningMode/permissionMode：同样 pending → kodaxDefaults → hardcoded fallback

import type { SessionMeta, ProviderInfo, KodaxUserDefaults } from '@kodax-space/space-ipc-schema';
import { resolveActiveModel } from './resolveActiveModel.js';

const MOCK_PROVIDER = 'mock';

export interface CreateSessionInput {
  readonly projectRoot: string;
  readonly providers: readonly ProviderInfo[];
  readonly defaultProviderId: string | null;
  readonly kodaxDefaults: KodaxUserDefaults | null;
  readonly pendingProviderId: string | null;
  readonly pendingReasoningMode: SessionMeta['reasoningMode'] | null;
  readonly pendingPermissionMode?: SessionMeta['permissionMode'] | null;
  readonly pendingAutoModeEngine?: SessionMeta['autoModeEngine'] | null;
  readonly pendingAgentMode?: SessionMeta['agentMode'] | null;
  /** User's pending (next-session) model — persisted; validated against the resolved provider. */
  readonly pendingModel?: string | null;
}

export interface CreateSessionResolved {
  readonly provider: string;
  readonly reasoningMode: SessionMeta['reasoningMode'];
  readonly permissionMode: NonNullable<SessionMeta['permissionMode']>;
  readonly autoModeEngine: NonNullable<SessionMeta['autoModeEngine']>;
  readonly agentMode: NonNullable<SessionMeta['agentMode']>;
  readonly runtimeOverrides: {
    readonly reasoningMode?: SessionMeta['reasoningMode'];
    readonly permissionMode?: NonNullable<SessionMeta['permissionMode']>;
    readonly autoModeEngine?: NonNullable<SessionMeta['autoModeEngine']>;
    readonly agentMode?: NonNullable<SessionMeta['agentMode']>;
  };
  /**
   * Effective model to create the session with. Resolved from the SAME source the
   * model picker shows (pending → kodaxDefaults → provider default). Passing it
   * EXPLICITLY (instead of leaving it undefined for the SDK to guess) lets KodaX
   * apply the model's per-model capabilities — notably its real contextWindow —
   * so auto-compaction uses the right window (2026-06-15 用户复报：默认模型下 run
   * 没拿到 glm-5.2 的 1M，压缩按 ~128k 触发)。undefined only when nothing resolves.
   */
  readonly model?: string;
}

/** 仅做 provider / reasoning / permission 解析；不发 IPC。便于测试。 */
export function resolveSessionCreateInputs(input: CreateSessionInput): CreateSessionResolved {
  const {
    providers,
    defaultProviderId,
    kodaxDefaults,
    pendingProviderId,
    pendingReasoningMode,
    pendingPermissionMode,
    pendingAutoModeEngine,
    pendingAgentMode,
  } = input;

  // 候选链：pending → Space default → KodaX default
  const candidates: readonly (string | null)[] = [
    pendingProviderId,
    defaultProviderId,
    kodaxDefaults?.provider ?? null,
  ];

  let provider: string = MOCK_PROVIDER;
  for (const c of candidates) {
    if (!c) continue;
    const p = providers.find((x) => x.id === c);
    if (p?.configured) {
      provider = c;
      break;
    }
  }
  if (provider === MOCK_PROVIDER) {
    const firstConfigured = providers.find((p) => p.configured && p.id !== MOCK_PROVIDER);
    if (firstConfigured) provider = firstConfigured.id;
  }

  const reasoningMode = pendingReasoningMode ?? kodaxDefaults?.reasoningMode ?? 'auto';
  const permissionMode = pendingPermissionMode ?? kodaxDefaults?.permissionMode ?? 'accept-edits';
  const autoModeEngine = pendingAutoModeEngine ?? 'llm';
  // Default 'ama' — KodaX SDK 默认也是这个；用户主动选 SA 走 fallback 路径
  const agentMode = pendingAgentMode ?? 'ama';
  const runtimeOverrides = {
    ...(pendingReasoningMode !== null ? { reasoningMode: pendingReasoningMode } : {}),
    ...(pendingPermissionMode !== null && pendingPermissionMode !== undefined
      ? { permissionMode: pendingPermissionMode }
      : {}),
    ...(pendingAutoModeEngine !== null && pendingAutoModeEngine !== undefined
      ? { autoModeEngine: pendingAutoModeEngine }
      : {}),
    ...(pendingAgentMode !== null && pendingAgentMode !== undefined
      ? { agentMode: pendingAgentMode }
      : {}),
  };

  // 解析生效 model（与 picker 同源），显式带上让 SDK 应用 per-model 能力。
  const activeProvider = providers.find((p) => p.id === provider);
  const resolvedModel = resolveActiveModel({
    activeProviderId: provider,
    activeProviderModels: activeProvider?.models,
    activeProviderDefaultModel: activeProvider?.defaultModel,
    pendingModel: input.pendingModel ?? null,
    kodaxDefaultsProvider: kodaxDefaults?.provider ?? null,
    kodaxDefaultsModel: kodaxDefaults?.model ?? null,
  });
  // resolveActiveModel 无解时返回 '—' 哨兵 — 别把它当真 model 传出去。
  const model = resolvedModel && resolvedModel !== '—' ? resolvedModel : undefined;

  return { provider, reasoningMode, permissionMode, autoModeEngine, agentMode, runtimeOverrides, model };
}

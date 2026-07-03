import type { ReasoningMode } from '@kodax-space/space-ipc-schema';

export function isSpaceReasoningMode(value: unknown): value is ReasoningMode {
  return (
    value === 'off' ||
    value === 'auto' ||
    value === 'quick' ||
    value === 'balanced' ||
    value === 'deep'
  );
}

export function reasoningModeToEffort(
  mode: ReasoningMode | string | undefined,
): string | undefined {
  switch (mode) {
    case 'off':
      return 'none';
    case 'auto':
      return 'auto';
    case 'quick':
      return 'low';
    case 'balanced':
      return 'medium';
    case 'deep':
      return 'high';
    default:
      return undefined;
  }
}

/** SDK canonical reasoning ladder, weakest → strongest. */
const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Minimal shape of the SDK `provider.getReasoningProfile(model)` result we consume. */
export interface ReasoningProfileLike {
  readonly supportedEfforts?: ReadonlyArray<{ readonly value: string }>;
  /** Efforts the provider HARD-rejects locally (throws) — e.g. kimi-code/minimax 'none'/'minimal'. */
  readonly localRejectEfforts?: readonly string[];
  readonly defaultEffort?: string;
}

/**
 * Map a Space reasoning mode to a wire effort that is actually VALID for the target provider.
 *
 * Space only has 5 buckets (off/auto/quick/balanced/deep); each provider exposes its own subset of
 * the 7-rung SDK ladder. A static mapping (reasoningModeToEffort) mis-fires two ways on 0.7.58:
 *   - localRejectEfforts: kimi-code / minimax-coding HARD-reject 'none'/'minimal' locally, so
 *     mapping "Off"→'none' throws on every turn (C4).
 *   - low static ceiling: mapping "Deep"→'high' can't reach a provider whose real ceiling is
 *     'xhigh'/'max' (GLM-5.2 zai-glm-5.2 preset, defaultEffort 'max') (C5).
 *
 * We resolve against the provider's real ladder, additionally excluding any efforts observed to be
 * rejected at the wire layer this process (rejectedEfforts, from KodaXEvents.onReasoningEffortRejected
 * → getCachedRejectedEfforts — C1). Effort *aliases* (e.g. GLM low→high) are applied by the SDK at
 * the wire layer, so we do NOT pre-apply them; we only pick a valid rung. With no profile (custom_*
 * providers / resolve failure) we fall back to the static legacy mapping.
 */
export function resolveWireEffort(
  mode: ReasoningMode | string | undefined,
  profile: ReasoningProfileLike | undefined | null,
  rejectedEfforts: readonly string[] = [],
): string | undefined {
  const base = reasoningModeToEffort(mode);
  // 'auto' and undefined pass through — the SDK resolves them itself.
  if (base === undefined || base === 'auto') return base;

  // The ONLY efforts we must never emit are the hard-rejected ones (localReject → throws;
  // observed wire-layer rejections → 400 + wasted retry). NOTE: an effort merely absent from
  // supportedEfforts is NOT excluded — e.g. Anthropic accepts 'none' for "Off" (thinking is a
  // separate flag) even though it isn't listed. disabledEfforts are also fine (SDK folds them).
  const rejected = new Set<string>([...(profile?.localRejectEfforts ?? []), ...rejectedEfforts]);
  const supported = new Set((profile?.supportedEfforts ?? []).map((e) => e.value));
  // Non-rejected rungs the provider actually declares — used for the "deep" ceiling and for
  // clamping a rejected request upward.
  const usable = EFFORT_LADDER.filter((e) => supported.has(e) && !rejected.has(e));

  // "Deep" == maximum reasoning: the provider's real ceiling (highest declared, non-rejected rung).
  // With no ladder info, keep the legacy 'high' unless it's rejected.
  if (mode === 'deep') {
    if (usable.length > 0) return usable[usable.length - 1];
    return rejected.has(base) ? undefined : base;
  }

  // Any other mode: send the mapped rung as-is unless it's hard-rejected.
  if (!rejected.has(base)) return base;

  // base is rejected (e.g. kimi-code/minimax 'none' for "Off"): clamp UP to the nearest declared,
  // non-rejected rung so we still send *some* valid effort instead of crashing.
  if (usable.length === 0) return undefined; // nothing safe to send → let the SDK default
  const idx = EFFORT_LADDER.indexOf(base as (typeof EFFORT_LADDER)[number]);
  const atOrAbove = usable.find((e) => EFFORT_LADDER.indexOf(e) >= idx);
  return atOrAbove ?? usable[0];
}

export function effortToReasoningMode(value: unknown): ReasoningMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (isSpaceReasoningMode(normalized)) return normalized;

  switch (normalized) {
    case 'none':
    case 'minimal':
      return 'off';
    case 'low':
      return 'quick';
    case 'medium':
      return 'balanced';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'deep';
    default:
      return undefined;
  }
}

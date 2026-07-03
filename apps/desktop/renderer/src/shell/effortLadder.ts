// Effort-ladder helpers — pure logic extracted from ModelEffortSelector so it is unit-testable
// without pulling in React/stores.

import type { ReasoningMode } from '@kodax-space/space-ipc-schema';

export const EFFORT_ORDER: readonly ReasoningMode[] = ['off', 'quick', 'balanced', 'auto', 'deep'];

/**
 * Map an SDK effort rung (from the reasoning profile) to Space's persisted ReasoningMode bucket.
 * Mirrors the main-process reasoning-effort.ts `effortToReasoningMode`. Returns null for an
 * unmappable rung.
 */
export function sdkEffortToReasoningMode(effort: string): ReasoningMode | null {
  switch (effort.trim().toLowerCase()) {
    case 'off':
    case 'none':
    case 'minimal':
      return 'off';
    case 'auto':
      return 'auto';
    case 'low':
      return 'quick';
    case 'medium':
      return 'balanced';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'deep';
    default:
      return null;
  }
}

/**
 * Build the visible effort ladder from the active model's SDK-declared efforts.
 *
 * - `auto` (let the model decide) is always available.
 * - `off` is available only when the provider can actually disable thinking. That's true when the
 *   provider does NOT hard-reject the "none" effort (`canDisableThinking`, computed main-side from
 *   the reasoning profile's localRejectEfforts) OR when it advertises a none/minimal rung directly.
 *   Providers like kimi-code / minimax-coding hard-reject 'none'/'minimal' and have no thinking-off
 *   mechanism — showing "Off" there mislabels a control that the runtime would silently clamp up to
 *   the weakest thinking rung, so we hide it.
 * - depth buckets (quick/balanced/deep) are shown only when the model supports a matching rung.
 *
 * With no effort info at all (unknown / non-reasoning model) we fall back to the full ladder, still
 * respecting an explicit `canDisableThinking === false`.
 */
export function visibleEffortLadder(
  supportedEfforts: readonly string[] | undefined,
  canDisableThinking = true,
): readonly ReasoningMode[] {
  if (!supportedEfforts || supportedEfforts.length === 0) {
    return canDisableThinking ? EFFORT_ORDER : EFFORT_ORDER.filter((mode) => mode !== 'off');
  }
  const allowed = new Set<ReasoningMode>(['auto']);
  if (canDisableThinking) allowed.add('off');
  for (const effort of supportedEfforts) {
    const mode = sdkEffortToReasoningMode(effort);
    if (mode) allowed.add(mode); // a declared none/minimal rung also implies "off" is available
  }
  return EFFORT_ORDER.filter((mode) => allowed.has(mode));
}

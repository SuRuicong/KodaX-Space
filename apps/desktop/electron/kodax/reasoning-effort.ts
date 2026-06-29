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

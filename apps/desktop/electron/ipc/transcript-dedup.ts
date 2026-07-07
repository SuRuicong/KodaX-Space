import { createHash } from 'node:crypto';

/**
 * Stable content identity used as the legacy fallback for old transcript data.
 * Entry ids and timestamps are intentionally excluded because compaction clones
 * change those fields while preserving the same logical message body.
 */
export function entryContentKey(entry: {
  readonly type?: unknown;
  readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
  readonly summary?: unknown;
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        t: entry.type ?? 'message',
        r: entry.message?.role ?? null,
        c: entry.message?.content ?? null,
        s: entry.summary ?? null,
      }),
    )
    .digest('hex');
}

/**
 * SDK eviction placeholder for old island message bodies. The real content is
 * intentionally gone, so history replay should skip it and rely on compaction
 * or branch summary notices to represent the boundary.
 */
export function isCompactedPlaceholder(entry: {
  readonly type?: unknown;
  readonly message?: { readonly content?: unknown } | null;
}): boolean {
  if (entry.type !== undefined && entry.type !== 'message') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return content === '[compacted]';
  if (Array.isArray(content)) {
    return (
      content.length === 1 &&
      typeof content[0] === 'object' &&
      content[0] !== null &&
      (content[0] as { type?: unknown }).type === 'text' &&
      (content[0] as { text?: unknown }).text === '[compacted]'
    );
  }
  return false;
}

export function isRewindMarker(entry: {
  readonly type?: unknown;
  readonly summary?: unknown;
  readonly payload?: unknown;
}): boolean {
  if (entry.type !== 'compaction') return false;
  const payload = entry.payload;
  if (
    payload &&
    typeof payload === 'object' &&
    (payload as { readonly reason?: unknown }).reason === 'rewind'
  ) {
    return true;
  }
  return typeof entry.summary === 'string' && entry.summary.startsWith('[Rewind]');
}

/**
 * Pick the entries history replay should render:
 * 1. Skip SDK `[compacted]` placeholders.
 * 2. Preserve every active-branch entry, including legitimate repeated text.
 * 3. Fold inactive compaction clones. New sessions prefer repeated logicalId;
 *    old sessions, where logicalId falls back to unique entryId, use content
 *    hashing as the legacy signal.
 */
export function dedupeTranscriptEntries<
  T extends {
    readonly active?: unknown;
    readonly logicalId?: unknown;
    readonly type?: unknown;
    readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
    readonly summary?: unknown;
    readonly payload?: unknown;
  },
>(entries: readonly T[]): T[] {
  const logicalIdCounts = countReusableLogicalIds(entries);
  const activeKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.active === true && !isCompactedPlaceholder(entry) && !isRewindMarker(entry)) {
      activeKeys.add(dedupeKey(entry, logicalIdCounts));
    }
  }

  const seenInactive = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (isCompactedPlaceholder(entry)) continue;
    if (isRewindMarker(entry)) continue;
    if (entry.active === true) {
      out.push(entry);
      continue;
    }
    const key = dedupeKey(entry, logicalIdCounts);
    if (activeKeys.has(key) || seenInactive.has(key)) continue;
    seenInactive.add(key);
    out.push(entry);
  }
  return out;
}

function countReusableLogicalIds(
  entries: readonly { readonly logicalId?: unknown }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (typeof entry.logicalId !== 'string' || entry.logicalId.length === 0) continue;
    counts.set(entry.logicalId, (counts.get(entry.logicalId) ?? 0) + 1);
  }
  return counts;
}

function dedupeKey(
  entry: {
    readonly logicalId?: unknown;
    readonly type?: unknown;
    readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
    readonly summary?: unknown;
  },
  logicalIdCounts: ReadonlyMap<string, number>,
): string {
  if (
    typeof entry.logicalId === 'string' &&
    entry.logicalId.length > 0 &&
    (logicalIdCounts.get(entry.logicalId) ?? 0) > 1
  ) {
    return `logical:${entry.logicalId}`;
  }
  return `content:${entryContentKey(entry)}`;
}

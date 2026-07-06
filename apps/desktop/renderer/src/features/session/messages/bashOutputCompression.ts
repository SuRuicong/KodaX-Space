const FILTER_MARKER_RE = /\[Bash output compressed by ([^\]]+?)\.\]/g;
const RAW_OUTPUT_HINT_RE =
  /\[Bash output compressed; full raw output saved to: (.+?)\. Use read on that path if details are needed\.\]/;

export interface BashOutputCompressionInfo {
  readonly filters: readonly string[];
  readonly rawOutputPath?: string;
}

export function parseBashOutputCompression(result: string): BashOutputCompressionInfo | null {
  const filters = [...result.matchAll(FILTER_MARKER_RE)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const rawOutputPath = RAW_OUTPUT_HINT_RE.exec(result)?.[1]?.trim();

  if (filters.length === 0 && !rawOutputPath) return null;
  return {
    filters: [...new Set(filters)],
    ...(rawOutputPath ? { rawOutputPath } : {}),
  };
}

export function stripBashOutputRecoveryHint(result: string): string {
  return result
    .replace(RAW_OUTPUT_HINT_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

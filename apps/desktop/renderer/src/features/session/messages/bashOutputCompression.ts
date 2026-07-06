// Capture groups are length-bounded + newline-excluded (filter names and paths are
// short single-line tokens). An unbounded lazy quantifier before a long fixed literal
// backtracks O(n^2) when the closing literal never appears — and this runs on EVERY
// bash tool result (agent-controlled, up to the 512 KiB tool_result ceiling), so an
// unbounded form freezes the renderer main thread on adversarial output. See
// bash-output-compression.test.ts for the large-input regression guard.
const FILTER_MARKER_RE = /\[Bash output compressed by ([^\]\n]{1,200}?)\.\]/g;
const RAW_OUTPUT_HINT_RE =
  /\[Bash output compressed; full raw output saved to: ([^\n]{1,2048}?)\. Use read on that path if details are needed\.\]/;

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

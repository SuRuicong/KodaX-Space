// Chart artifact spec (F056) — a declarative JSON chart, rendered with recharts
// in the renderer (NO eval, NO iframe, NO LiveCanvas). The AI produces a spec;
// ChartArtifact maps it to recharts elements.
//
// Pure + zod-validated so it is unit-testable (electron/test/chart-spec.test.ts)
// and so a malformed spec degrades safely instead of crashing the panel.

import { z } from 'zod';

// Cell values are strings (categories/labels) or numbers (measures).
const cellSchema = z.union([z.string(), z.number(), z.null()]);

// Display strings (axis key, series key/label, title) come from untrusted AI
// output and surface as recharts text. React escapes them (no XSS), but we reject
// C0/C1 controls + Unicode Bidi overrides/isolates so a label can't visually
// spoof (e.g. an RTL-override reordering glyphs to misrepresent a value).
// Char-code check (not a regex literal) to keep the source pure ASCII.
function hasBidiOrControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true; // C0 controls + DEL
    if (c >= 0x202a && c <= 0x202e) return true; // LRE/RLE/PDF/LRO/RLO
    if (c >= 0x2066 && c <= 0x2069) return true; // LRI/RLI/FSI/PDI
  }
  return false;
}

const displayString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !hasBidiOrControl(s), {
      message: 'control/bidi characters are not allowed',
    });

export const chartSpecSchema = z.object({
  type: z.enum(['line', 'bar', 'area']),
  /** Row-oriented data: each row is a record keyed by xKey + each series key. */
  data: z.array(z.record(cellSchema)).min(1).max(5000),
  /** Field used for the category (X) axis. */
  xKey: displayString(128),
  /** One entry per plotted measure. */
  series: z
    .array(
      z.object({
        key: displayString(128),
        label: displayString(128).optional(),
        /** CSS color; validated loosely (no injection risk — used as an SVG attr). */
        color: z
          .string()
          .max(32)
          .regex(/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(rgb|hsl)a?\([0-9.,%\s/]+\)$/)
          .optional(),
      }),
    )
    .min(1)
    .max(12),
  title: displayString(200).optional(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export type ParseChartResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; error: string };

/** Parse + validate an untrusted chart spec. Never throws. */
export function parseChartSpec(raw: unknown): ParseChartResult {
  const parsed = chartSpecSchema.safeParse(raw);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : '';
  return { ok: false, error: `invalid chart spec${where}: ${issue?.message ?? 'unknown'}` };
}

/** Default palette (semantic amber-forward, aligned with F054 accent). */
export const CHART_PALETTE: readonly string[] = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

/** Color for a series, falling back to the palette by index. */
export function seriesColor(spec: ChartSpec, index: number): string {
  return spec.series[index]?.color ?? CHART_PALETTE[index % CHART_PALETTE.length] ?? '#f59e0b';
}

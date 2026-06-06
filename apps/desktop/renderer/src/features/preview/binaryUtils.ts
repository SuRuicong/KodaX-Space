// Binary helpers for F024 rich preview viewers (PDF / docx / xlsx).
// Each viewer receives base64-encoded bytes via IPC and decodes locally.

/** Decode base64 → Uint8Array. Pure browser API (atob); no Buffer/Node deps. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Per-file-type size caps (bytes) — passed to files.readBinary IPC. */
export const PREVIEW_SIZE_CAPS = {
  pdf: 50 * 1024 * 1024, // 50 MB — PDFs can legitimately be large
  docx: 10 * 1024 * 1024, // 10 MB
  xlsx: 10 * 1024 * 1024, // 10 MB
} as const;

export type RichPreviewKind = keyof typeof PREVIEW_SIZE_CAPS;

/** Detect rich preview kind from filename. Returns null for plain text / unknown. */
export function detectKind(path: string): RichPreviewKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return null;
}

/** Format bytes for human-readable error messages. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

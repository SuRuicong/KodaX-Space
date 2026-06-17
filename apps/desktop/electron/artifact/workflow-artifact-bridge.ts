// F066 — 把 workflow run 产出的 artifact 内容映射成 Space artifact（kind + content 串）。
//
// 方案 A：workflow artifact 桥进 artifactStore，与 agent 直接产的统一面板（复用 F057-F059
// 预览/版本/导出/弹窗）。SDK 的 readWorkflowArtifact 返回 unknown（脚本里 wf.artifact() 存的
// 任意 JSON 值）；这里把它收敛成 Space 的 ArtifactKindT + 内联文本内容。
//
// 纯函数（无副作用）以便单测。

import type { ArtifactKindT } from '@kodax-space/space-ipc-schema';

export interface DetectedArtifact {
  readonly kind: ArtifactKindT;
  readonly content: string;
}

// 必须 ≤ artifactStore 的 MAX_ARTIFACT_CONTENT_BYTES（1_048_576 UTF-8 *字节*，超则 upsert 抛错）。
// 按字节截断（不是字符数！多字节 CJK/emoji 下字符数 ≠ 字节数，按字符截会超字节上限被拒、artifact 丢失）。
// 留 64 字节余量：末尾切断的多字节序列 toString 后变 U+FFFD(3 字节) 可能略增长，避免再编码超限。
const STORE_MAX_BYTES = 1_048_576;
const MAX_BRIDGE_BYTES = STORE_MAX_BYTES - 64;

function clip(s: string): string {
  if (Buffer.byteLength(s, 'utf8') <= MAX_BRIDGE_BYTES) return s;
  return Buffer.from(s, 'utf8').subarray(0, MAX_BRIDGE_BYTES).toString('utf8');
}

/** 嗅探字符串内容的 kind（html/svg/markdown/code）。 */
function detectStringKind(s: string): ArtifactKindT {
  const head = s.trimStart().slice(0, 256).toLowerCase();
  if (head.startsWith('<svg') || head.includes('<svg ')) return 'svg';
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html')) return 'html';
  // markdown 启发：标题 / 列表 / 围栏代码块 等标记
  if (/^#{1,6}\s|\n#{1,6}\s|^[-*]\s|\n[-*]\s|```/.test(s.slice(0, 512))) return 'markdown';
  return 'code';
}

/**
 * 把任意 workflow artifact 值收敛成 Space artifact。
 *   - string → 嗅探 kind（html/svg/markdown/code）
 *   - object/array/其它 → JSON 串，kind=code
 *   - null/undefined → 空 markdown（保留条目，不丢）
 */
export function detectArtifactKind(value: unknown): DetectedArtifact {
  if (typeof value === 'string') {
    return { kind: detectStringKind(value), content: clip(value) };
  }
  if (value === null || value === undefined) {
    return { kind: 'markdown', content: '' };
  }
  // 对象/数组/数字/布尔 → JSON 文本（code）
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    json = String(value);
  }
  return { kind: 'code', content: clip(json) };
}

// Permission display sanitization — review H3-sec (2026-05-17)
//
// LLM 输出是 UNTRUSTED。push 给 renderer 的 permission.request payload 里：
//   - toolName 可能含 RTL override：U+202E + "read" 在 modal 上显示成 "daer"——
//     用户被骗以为是 read，实际是 write
//   - reason / input 字段值同理，可塞零宽 / RTL / 控制字符破坏 UI 文本流
//
// 这里跟 host.ts 的 sanitizeTitle 同源策略，但拆出来是因为：
//   - sanitizeTitle 默认 "Untitled" 回退 + 长度 50 截断——对 session 标题合适
//   - permission 弹窗不能 fallback 到 "Untitled"（用户得知道是哪个工具）；
//     也不能 50 字截断（input 可能是个完整命令）
// 所以本模块单独实现，复用同款字符集但走自己的截断 + 空字符串策略。
//
// 注意范围：本模块只剥**显示用**字符串。risk.ts 的危险命令检测在**原始** input 上跑——
// 攻击者用 unicode space 替换 ASCII space 试图绕过 \s+ 的招数仍由 risk 自己处理
// （JS 的 \s 含 Unicode 空白，覆盖 U+00A0 / U+1680 / U+2000-200A 等）。
//
// 字符范围用 \u escape 而不是 literal——literal control / RTL / 零宽字符在源码里
// 被各种编辑器 / git EOL 配置 / 终端复制粘贴破坏的概率太高（host.ts 的 regex 就
// 已经因为这个问题在 review 之后被改成 \u 形式过）。
// 覆盖：
//   U+0000-001F  C0 控制符
//   U+007F-009F  DEL + C1 控制符
//   U+200B-200F  零宽 + LRM / RLM
//   U+202A-202E  LRE / RLE / PDF / LRO / RLO — RTL override（攻击重点）
//   U+2066-2069  isolate（LRI / RLI / FSI / PDI）— 较新的方向操控
//   U+FEFF       BOM / 零宽不间断空格

const INVISIBLE_CHARS_RE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * 剥控制符 / RTL override / 零宽 / BOM，折叠空白。
 * 空字符串返回空字符串（不 fallback 到 "Untitled"——上层决定怎么处理）。
 * maxLen 兜底防 LLM 塞超长字符串撑爆 modal。
 */
export function sanitizeForDisplay(input: string, maxLen: number): string {
  const stripped = input.replace(INVISIBLE_CHARS_RE, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  const scalars = Array.from(collapsed);
  if (scalars.length <= maxLen) return scalars.join('');
  return scalars.slice(0, maxLen - 1).join('') + '…';
}

/**
 * 递归地清洗 input record 里所有 string 值；非 string 原样保留。
 * 数组 / object 递归一层（不递归到深层嵌套——LLM tool input 通常是浅 record，
 * 真有深嵌套也只清洗第一层避免 stack overflow / 性能问题）。
 *
 * 单 string 上限 4096：超出长度的字符串通常是 tool output 被 LLM 当 input 回灌
 * （e.g., read 一整个文件然后 write 到另一处），modal 里没意义全部显示；
 * UI 渲染时再二次 truncate 到可视范围。
 */
export function sanitizeInputForDisplay(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(v: unknown): unknown {
  if (typeof v === 'string') return sanitizeForDisplay(v, 4096);
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof val === 'string' ? sanitizeForDisplay(val, 4096) : val;
    }
    return out;
  }
  return v;
}

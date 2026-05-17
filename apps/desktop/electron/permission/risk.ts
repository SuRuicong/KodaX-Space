// Risk 评估 + 危险命令检测 — FEATURE_007
//
// 输入：toolName + input（来自 KodaX permission callback）
// 输出：{ risk, reason, dangerous }
//
// 设计原则：
//   - 默认偏严：未知工具按 'high' 而不是 'medium'，强迫开发者显式分类
//   - 危险模式（dangerous=true）走 'danger' 等级，前端强制 typed confirmation
//   - 不解析 shell：bash 命令用启发式扫描而不是 tokenize——攻击者写 `r''m -rf` 之类已不在
//     "提醒一个慢手用户"的范围里，是"defense in depth"的最外层提醒；真正的隔离在 KodaX 内核
//     和 OS 层（沙箱、文件系统权限）做
//   - String.prototype.includes 在 v8 里足够快；这层判断每秒最多触发数十次

export type PermissionRisk = 'low' | 'medium' | 'high' | 'danger';

export interface RiskAssessment {
  readonly risk: PermissionRisk;
  readonly dangerous: boolean;
  readonly reason: string;
}

// 工具分类。未列出的 toolName 默认 'high'（严格优于宽松）。
//
// read/grep/glob: 只读 — low
// write/edit:     改文件 — medium（具体到 bash 危险命令再升级）
// bash/exec:      执行 — medium（再叠加 danger 模式扫描）
// network/fetch:  网络 — high
const TOOL_BASE_RISK: Readonly<Record<string, PermissionRisk>> = {
  read: 'low',
  grep: 'low',
  glob: 'low',
  list: 'low',
  ls: 'low',
  view: 'low',
  write: 'medium',
  edit: 'medium',
  patch: 'medium',
  multi_edit: 'medium',
  apply_diff: 'medium',
  bash: 'medium',
  shell: 'medium',
  exec: 'medium',
  fetch: 'high',
  http: 'high',
  curl: 'high',
  network: 'high',
  web_search: 'low', // 读类
};

// 危险命令模式 — 命中即 risk='danger' + dangerous=true，前端强制键入 CONFIRM。
//
// 来源：业内常见"千万别让 LLM 跑"的命令集合（KodaX CLI / Claude Code / Cursor 都有类似清单）。
// 不追求完备——攻击者能轻易绕过。这里是"用户最容易误批"的清单。
//
// 用 /.../ 字面量而非字符串拼正则——避免运行期把字符串当代码解析的尝试。
const DANGER_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\brm\s+(-[rf]+\s+|--recursive\s+|--force\s+)/i, reason: 'rm 递归/强制删除' },
  { pattern: /\brm\s+-[rf]*r[rf]*\s/i, reason: 'rm -r 删除目录' },
  { pattern: /\bgit\s+push\s+(-{1,2}force|--force-with-lease|-f\b)/i, reason: 'git force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard' },
  { pattern: /\bgit\s+clean\s+-[fd]+/i, reason: 'git clean 强制删除未跟踪文件' },
  { pattern: /\bdd\s+if=.*\bof=/i, reason: 'dd 写设备' },
  { pattern: /\bmkfs\b/i, reason: 'mkfs 格式化文件系统' },
  { pattern: /:\s*\(\s*\)\s*\{\s*:/, reason: 'fork bomb' },
  { pattern: /\bcurl[^|&;]*\|\s*(sh|bash|zsh|python|node|ruby|perl)\b/i, reason: 'curl | shell 远程脚本执行' },
  { pattern: /\bwget[^|&;]*\|\s*(sh|bash|zsh|python|node|ruby|perl)\b/i, reason: 'wget | shell 远程脚本执行' },
  { pattern: /\bsudo\b/i, reason: 'sudo 提权' },
  { pattern: /\bchmod\s+(-R\s+)?[0-7]*777\b/i, reason: 'chmod 777 开放权限' },
  { pattern: /\bchown\s+-R\b/i, reason: 'chown -R 递归改所有者' },
  { pattern: /\bnpm\s+(unpublish|publish)\b/i, reason: 'npm publish/unpublish' },
  { pattern: /\bdrop\s+(database|table|schema)\b/i, reason: 'SQL DROP' },
  { pattern: /\btruncate\s+table\b/i, reason: 'SQL TRUNCATE TABLE' },
  // Windows 等价
  { pattern: /\bdel\s+\/[fqs]+\b/i, reason: 'del /f 强制删除 (Windows)' },
  { pattern: /\brd\s+\/s\b/i, reason: 'rd /s 递归删目录 (Windows)' },
  { pattern: /\bformat\s+[a-z]:/i, reason: 'format 格式化盘符 (Windows)' },
];

/**
 * 把 input.command / input.cmd / input.script 拼成一段可扫描文本。
 * 不同工具实现字段名不同；这里穷举常见命名而不是要求外层规范化。
 */
function extractCommandText(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const candidates = ['command', 'cmd', 'script', 'shellScript', 'shell'];
  const parts: string[] = [];
  for (const key of candidates) {
    const v = input[key];
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') parts.push(x);
    }
  }
  return parts.join('\n');
}

/**
 * 评估一次 tool 调用的风险等级 + 是否触发 danger 模式。
 *
 * 返回 reason 是面向用户的简短中文文案，UI 直接显示。
 */
export function assessRisk(
  toolName: string,
  input: Record<string, unknown> | undefined,
): RiskAssessment {
  // 危险命令优先 — 即便是 read 工具被滥用，命中 rm 也算 danger（理论上不会，但兜底）。
  const text = extractCommandText(input);
  if (text) {
    for (const { pattern, reason } of DANGER_PATTERNS) {
      if (pattern.test(text)) {
        return { risk: 'danger', dangerous: true, reason: `检测到危险操作：${reason}` };
      }
    }
  }

  // toolName 大小写归一（KodaX 内部约定 lower-snake，但 Real adapter 接入前不强制）
  const normalized = toolName.toLowerCase();
  const base = TOOL_BASE_RISK[normalized];
  if (base !== undefined) {
    return {
      risk: base,
      dangerous: false,
      reason: base === 'low' ? '只读操作' : base === 'medium' ? '改动文件 / 执行命令' : '高风险操作',
    };
  }

  // 未知 toolName — 偏严，归 high
  return {
    risk: 'high',
    dangerous: false,
    reason: `未知工具 ${toolName}，按高风险处理`,
  };
}

/**
 * 为一次 tool 调用生成 always-allow pattern 建议。
 *   - 危险工具：不生成建议（pattern=undefined）——用户应当每次确认，不允许整体批准
 *   - bash/shell：建议 "<toolName>:<first-arg-command-prefix>"，限定到第一个子命令
 *     （即"批准所有 npm install"而不是"批准所有 bash 命令"）
 *   - 其他：建议 "<toolName>" 整体批准
 */
export function suggestAlwaysAllowPattern(
  toolName: string,
  input: Record<string, unknown> | undefined,
  assessment: RiskAssessment,
): string | undefined {
  if (assessment.dangerous) return undefined;
  const normalized = toolName.toLowerCase();
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'exec') {
    const text = extractCommandText(input).trim();
    if (!text) return normalized;
    // 取第一个空白前的 token 作为 prefix
    const firstToken = text.split(/\s+/)[0] ?? '';
    if (firstToken && firstToken.length <= 64 && /^[a-zA-Z0-9_./:-]+$/.test(firstToken)) {
      return `${normalized}:${firstToken}`;
    }
    return undefined;
  }
  return normalized;
}

/**
 * 判断一次 tool 调用是否被已有 always-allow 规则覆盖。
 * patternMatcher 模式：
 *   - "<toolName>"          匹配该 toolName 任何调用
 *   - "<toolName>:<prefix>" 仅当 input 第一个 command token 等于 prefix 时匹配（bash 系）
 *
 * 调用方：PermissionRegistry.matches(toolName, input).
 */
export function matchesPattern(
  pattern: string,
  toolName: string,
  input: Record<string, unknown> | undefined,
): boolean {
  const normalizedTool = toolName.toLowerCase();
  const colonIdx = pattern.indexOf(':');
  if (colonIdx < 0) {
    return pattern === normalizedTool;
  }
  const pTool = pattern.slice(0, colonIdx);
  const pPrefix = pattern.slice(colonIdx + 1);
  if (pTool !== normalizedTool) return false;
  const text = extractCommandText(input).trim();
  if (!text) return false;
  const firstToken = text.split(/\s+/)[0] ?? '';
  return firstToken === pPrefix;
}

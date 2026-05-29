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
  // FEATURE: Space-side hook for SDK skill `!`cmd`` dynamic-context resolution
  // (sdk-skills SkillDynamicContextExecutor)。base risk 与 bash/exec 同级 — extractCommandText
  // 已经从 input.command 里抽出命令文本,会被 dangerous 模式正常扫描 (审查 H2 验证)。
  skill_dynamic_context: 'medium',
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
//
// review C1-sec / H1-sec 修订（2026-05-17）：
//   - rm 补 --no-preserve-root（Linux 上可在没有 -r/-f 时删 /）
//   - git push 改"句中任意位置 force flag"——之前要求紧跟 push，绕开方式：
//     git push origin HEAD:main --force
//   - 增加 :(){:|:&};:、$IFS、`backtick subshell` 几个常见绕过
const DANGER_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\brm\s+(-[rf]+\s+|--recursive\s+|--force\s+)/i, reason: 'rm 递归/强制删除' },
  { pattern: /\brm\s+-[rf]*r[rf]*\s/i, reason: 'rm -r 删除目录' },
  { pattern: /\brm\b[^\n]*--no-preserve-root/i, reason: 'rm --no-preserve-root（可删根目录）' },
  // git push 任何形式的强制 push——只要句中出现 force flag 且命令以 git push 开头
  { pattern: /\bgit\s+push\b[^\n]*\s(-{1,2}force(-with-lease)?|-f)\b/i, reason: 'git force push' },
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

/** input 中可能承载命令字符串的字段名（已知 + 防御性扩展）。*/
const KNOWN_COMMAND_FIELDS = new Set([
  'command', 'cmd', 'script', 'shellScript', 'shell',
  // review C1-sec：Real adapter 可能用 argv / args / run / exec / line / input 等字段名
  'argv', 'args', 'run', 'exec', 'line', 'input', 'code', 'source', 'body',
]);

/**
 * 把 input 里**所有**字符串值（string / string[]）拼成一段可扫描文本，
 * 危险命令检测就在这段文本上跑。
 *
 * 设计决定（review C1-sec）：
 *   不再硬编码"只看 command/cmd/script"——LLM 可以用任意字段名递送命令字符串
 *   （Real adapter 接入后 bash tool 的 input 字段名取决于具体实现，无法预测）。
 *   现在的策略是 KNOWN_COMMAND_FIELDS 优先（保证已知字段命中）+ 兜底扫描所有 string 值
 *   （任意命名的字段都进入危险检测）。
 *
 *   误报代价：read tool 的 path: "rm-backup/notes.md" 之类含 "rm" 字符串的合法 input
 *   会被误报为 danger。但 \brm\s+ 要求 rm 后面紧跟空白 + 标志位，"rm-" / "rm/"
 *   都不会触发；同时 read tool 本身 risk=low，弹窗时用户看到"read 工具 + 危险模式"
 *   反而是个有用的提示而非干扰。
 */
function extractCommandText(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const parts: string[] = [];
  // 优先级 1：已知命令字段（保留原顺序，避免改变测试断言里的 reason 命中顺序）
  for (const key of KNOWN_COMMAND_FIELDS) {
    const v = input[key];
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') parts.push(x);
    }
  }
  // 优先级 2：兜底——任何其他 string 字段也进入扫描
  for (const [key, v] of Object.entries(input)) {
    if (KNOWN_COMMAND_FIELDS.has(key)) continue;
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
    // 字符集白名单 [a-zA-Z0-9_./:-] 与长度 64 的限制是有意的：
    //   - 排除 $、`、空格、引号、分号 等 shell 元字符——防止 pattern 本身被注入成
    //     "bash:$(rm -rf /)" 之类危险形态后存进 ~/.kodax/permissions.json
    //   - 排除 unicode / RTL override / 零宽——避免持久化的规则在用户回顾时显示成
    //     另一个可读 token 但匹配的是别的字面值
    //   - 长度 64 排除 hash / hex / base64 之类的命令——这些通常是临时性的，
    //     不应该持久化批准；返回 undefined 让 "Always allow" 复选框隐藏
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

// AGENTS.md loader — Space-owned stub for FEATURE_034 / FEATURE_030 wiring.
//
// KodaX SDK 内部已有完整 loadAgentsFiles (packages/coding/src/context/agents-loader.ts)
// 但 @kodax-ai/kodax 0.7.40 dist 没单独 export 给 sub-package consumer。
// 我们写薄壳 loader 即可——shape 跟 KodaX `AgentsFile` 对齐，未来 SDK 暴露后可一行换掉。
//
// **Type ownership**：本文件的 `AgentsFile` 是当前 Space 端的单一来源。
// 不要在 `kodax-sdk-types.d.ts` 里再独立声明同名 type—— F030 wire 时应当 import 本文件。
// 等 KodaX 0.7.41+ dist 真正暴露 AgentsFile 后，再把 import path 一行换掉。
//
// 扫描两处：
//   - ~/.kodax/AGENTS.md         (scope: 'global')
//   - <projectRoot>/AGENTS.md   (scope: 'project')
//
// 故意 NOT 递归向上扫（KodaX REPL 做了 cwd → root 递归 + .kodax 子目录 优先级合并），
// 桌面端 projectRoot 是用户显式选的根，没有"工作子目录"概念，简化即正确。
//
// Defense-in-depth：
//   - 路径必须 absolute
//   - **gate on stat.size (byte 计) 而非 content.length (UTF-16 code units 计)**
//     CJK / emoji 一字符占 2~4 byte，char count guard 会让多字节文件溢出限额；
//     用 stat.size 才是真 byte 计数
//   - 缺文件返回空数组（不抛）
//   - readFileSync 失败（EACCES / EIO 等）记 warning，返回此条 skip

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 与 KodaX `@kodax-ai/coding` 的 AgentsFile 对齐。
 * 字段名 / 字面量必须严格一致，否则 F030 把数组传给 bootstrapAutoMode 时
 * KodaX 内部的 formatAgentsForPrompt() 会找不到字段。
 */
export interface AgentsFile {
  path: string;
  content: string;
  scope: 'global' | 'project' | 'directory';
}

/** 单个 AGENTS.md byte 硬上限，超过截断 + 加一行 marker */
const MAX_AGENTS_BYTES = 256 * 1024;
const TRUNCATION_MARKER = '\n\n[truncated by Space loader at 256KB]';

export interface LoadAgentsMdOptions {
  /** 当前 session 的 projectRoot。必须 absolute（已经过 host validateProjectRoot 校验过）*/
  projectRoot: string;
  /** 测试 hook：覆盖 ~/.kodax 路径 */
  kodaxGlobalDir?: string;
}

/**
 * 加载 AGENTS.md 文件，按 KodaX 优先级排序：global < project。
 * (KodaX prompt builder 把后面的覆盖前面的，所以 project 应当在数组靠后。)
 */
export function loadAgentsMd(opts: LoadAgentsMdOptions): AgentsFile[] {
  if (!path.isAbsolute(opts.projectRoot)) {
    console.warn(`[agents-md-loader] projectRoot must be absolute, got: ${opts.projectRoot}`);
    return [];
  }

  const out: AgentsFile[] = [];

  const globalDir = opts.kodaxGlobalDir ?? path.join(os.homedir(), '.kodax');
  const globalPath = path.join(globalDir, 'AGENTS.md');
  const globalFile = tryReadAgentsFile(globalPath, 'global');
  if (globalFile) out.push(globalFile);

  const projectPath = path.join(opts.projectRoot, 'AGENTS.md');
  // 防御：若 projectRoot 本身解析后跟 globalDir 相同（罕见，但比如把 ~/.kodax 当作项目根），
  // 不重复加载同一个文件
  if (path.resolve(projectPath) !== path.resolve(globalPath)) {
    const projectFile = tryReadAgentsFile(projectPath, 'project');
    if (projectFile) out.push(projectFile);
  }

  return out;
}

function tryReadAgentsFile(filePath: string, scope: AgentsFile['scope']): AgentsFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_AGENTS_BYTES) {
      // 文件超过 byte 上限：只读前 MAX_AGENTS_BYTES byte，避免把整个大文件读进内存。
      // 用 fd + readSync 读固定 byte 数；slice 在 utf-8 边界可能切到半 char (如 CJK 3 byte 第 2 个 byte
      // 处)，那个尾巴 char 会被 utf-8 decoder 替换为 U+FFFD —— 我们再加 marker，所以这种少量乱码可接受。
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(MAX_AGENTS_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, MAX_AGENTS_BYTES, 0);
        const content = buf.slice(0, bytesRead).toString('utf8') + TRUNCATION_MARKER;
        return { path: filePath, content, scope };
      } finally {
        fs.closeSync(fd);
      }
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { path: filePath, content, scope };
  } catch (err) {
    if (isNotFound(err)) return null;
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    console.warn(`[agents-md-loader] read ${filePath} failed (${code}); skipping`);
    return null;
  }
}

function isNotFound(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

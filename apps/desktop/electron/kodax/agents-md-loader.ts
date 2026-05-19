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
//   - 缺文件返回 null/[]（不抛）
//   - read 失败（EACCES / EIO 等）记 warning，返回此条 skip
//
// **异步**：走 fs.promises 而非 fs.*Sync——Electron main process 单 IPC 事件循环，
// 同步 I/O 会卡其他 IPC handler（network 盘 / WSL mount 上 256KB 文件可能慢 50-500ms）。

import { promises as fsp } from 'node:fs';
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
export const MAX_AGENTS_BYTES = 256 * 1024;
/**
 * 截断 marker。**保持 < 64 chars**——session.ts agentsFileSchema 的 content max
 * = MAX_AGENTS_BYTES + 64 给 marker 留的 buffer。延长 marker 时同步该 schema cap。
 */
export const TRUNCATION_MARKER = '\n\n[truncated by Space loader at 256KB]';

export interface LoadAgentsMdOptions {
  /** 当前 session 的 projectRoot。必须 absolute（已经过 host validateProjectRoot 校验过）*/
  projectRoot: string;
  /** 测试 hook：覆盖 ~/.kodax 路径 */
  kodaxGlobalDir?: string;
}

/**
 * 加载 AGENTS.md 文件，按 KodaX 优先级排序：global < project。
 * (KodaX prompt builder 把后面的覆盖前面的，所以 project 应当在数组靠后。)
 *
 * **Async**：用 fs.promises 而非 fs.*Sync——Electron main process 单 IPC 事件循环
 * 不能被同步 I/O 卡住（reviewer F034 HIGH-1）。
 */
export async function loadAgentsMd(opts: LoadAgentsMdOptions): Promise<AgentsFile[]> {
  if (!path.isAbsolute(opts.projectRoot)) {
    console.warn(`[agents-md-loader] projectRoot must be absolute, got: ${opts.projectRoot}`);
    return [];
  }

  const out: AgentsFile[] = [];

  const globalDir = opts.kodaxGlobalDir ?? path.join(os.homedir(), '.kodax');
  const globalPath = path.join(globalDir, 'AGENTS.md');
  const globalFile = await tryReadAgentsFile(globalPath, 'global');
  if (globalFile) out.push(globalFile);

  const projectPath = path.join(opts.projectRoot, 'AGENTS.md');
  // 防御：若 projectRoot 本身解析后跟 globalDir 相同（罕见，但比如把 ~/.kodax 当作项目根），
  // 不重复加载同一个文件
  if (path.resolve(projectPath) !== path.resolve(globalPath)) {
    const projectFile = await tryReadAgentsFile(projectPath, 'project');
    if (projectFile) out.push(projectFile);
  }

  return out;
}

async function tryReadAgentsFile(
  filePath: string,
  scope: AgentsFile['scope'],
): Promise<AgentsFile | null> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_AGENTS_BYTES) {
      // 文件超过 byte 上限：只读前 MAX_AGENTS_BYTES byte，避免把整个大文件读进内存。
      // utf-8 边界可能切到半 char (CJK 3 byte 第 2 byte 处)，尾巴 char 被 utf-8 decoder
      // 替换为 U+FFFD —— 再加 marker，少量乱码可接受。
      const handle = await fsp.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(MAX_AGENTS_BYTES);
        const { bytesRead } = await handle.read(buf, 0, MAX_AGENTS_BYTES, 0);
        const content = buf.slice(0, bytesRead).toString('utf8') + TRUNCATION_MARKER;
        return { path: filePath, content, scope };
      } finally {
        await handle.close();
      }
    }
    const content = await fsp.readFile(filePath, 'utf8');
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

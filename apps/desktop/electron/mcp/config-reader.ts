// MCP config reader — FEATURE_036 alpha.1 (read-only).
//
// 读 KodaX 的 user-level 和 project-level config，提取 mcpServers 字段。
// **不**用 SDK API（KodaX 0.7.40 没暴露 MCP 管理 surface；REPL 走 capabilityProviders
// 内部 API，没 export）。等 v0.1.7 SDK ready 后接 F039 完整版（启停 / 日志 / tool catalog）。
//
// 文件路径（与 KodaX REPL 0.7.40 实际行为对齐）：
//   ~/.kodax/config.json                — global
//   ${projectRoot}/.kodax/config.json   — project（可选；KodaX 自己 merge）
//
// 安全：
//   - 文件不存在 → 不抛，返回空
//   - JSON 损坏 → errors 数组带 path + reason，UI 给用户提示
//   - 单个 server 条目 shape 不对 → 跳过该条 + 加 errors 项；其他正常 server 仍出
//   - 不读 envCount 里的实际 env value（可能含 secrets）；只暴露 count

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServerMeta } from '@kodax-space/space-ipc-schema';

const MAX_CONFIG_BYTES = 1_048_576; // 1 MB 大配置文件兜底
const MAX_SERVERS_PER_FILE = 128;
const MAX_ERROR_KEY_LEN = 64; // server name 显示给 errors[].path 的截断长度

/**
 * 把 server name 处理后再拼到 errors[].path 后面（'#name' 后缀）：
 *   - strip control chars / 不可打印 (防 ANSI escape / 终端注入风险)
 *   - 截断到 64 字符（防超长 name 把 errors 行撑爆）
 * 单纯展示用，原始 name 仍然保留在 servers[] 列表的 name 字段（schema 已限制 max 128）。
 */
function sanitizeKeyForErrorPath(name: string): string {
  const stripped = name.replace(/[\x00-\x1f\x7f]/g, '?'); // eslint-disable-line no-control-regex
  return stripped.length > MAX_ERROR_KEY_LEN
    ? `${stripped.slice(0, MAX_ERROR_KEY_LEN)}…`
    : stripped;
}

interface DiscoverOptions {
  readonly projectRoot: string;
  /** 测试注入用；缺省 os.homedir()/.kodax */
  readonly kodaxGlobalDir?: string;
}

export interface DiscoverResult {
  readonly servers: McpServerMeta[];
  readonly errors: Array<{ path: string; error: string }>;
}

/**
 * 读 global + project config 的 mcpServers，合并返回。同名 server project 覆盖 global。
 */
export async function discoverMcpServers(opts: DiscoverOptions): Promise<DiscoverResult> {
  if (!path.isAbsolute(opts.projectRoot)) {
    return {
      servers: [],
      errors: [
        { path: opts.projectRoot, error: 'projectRoot must be absolute' },
      ],
    };
  }

  const errors: Array<{ path: string; error: string }> = [];
  const globalDir = opts.kodaxGlobalDir ?? path.join(os.homedir(), '.kodax');
  const globalPath = path.join(globalDir, 'config.json');
  const projectPath = path.join(opts.projectRoot, '.kodax', 'config.json');

  // global 先读，project 后读——project 覆盖同名 global
  const globalServers = await readServersFromFile(globalPath, 'global', errors);
  const projectServers =
    path.resolve(projectPath) === path.resolve(globalPath)
      ? [] // 罕见但防御：projectRoot 恰好等于 globalDir
      : await readServersFromFile(projectPath, 'project', errors);

  const byName = new Map<string, McpServerMeta>();
  for (const s of globalServers) byName.set(s.name, s);
  for (const s of projectServers) byName.set(s.name, s); // project 覆盖 global

  return { servers: [...byName.values()], errors };
}

async function readServersFromFile(
  filePath: string,
  source: 'global' | 'project',
  errors: Array<{ path: string; error: string }>,
): Promise<McpServerMeta[]> {
  let text: string;
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return [];
    if (stat.size > MAX_CONFIG_BYTES) {
      errors.push({ path: filePath, error: `config file too large (${stat.size} bytes)` });
      return [];
    }
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return []; // 缺文件正常
    errors.push({
      path: filePath,
      error: `read failed: ${(err as Error).message ?? String(err)}`,
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    errors.push({ path: filePath, error: `invalid JSON: ${(err as Error).message}` });
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push({ path: filePath, error: 'top-level must be a JSON object' });
    return [];
  }
  const root = parsed as Record<string, unknown>;
  const mcp = root.mcpServers;
  if (mcp === undefined) return []; // 无 mcpServers 字段不是错误
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) {
    errors.push({ path: filePath, error: 'mcpServers must be a JSON object' });
    return [];
  }

  const out: McpServerMeta[] = [];
  const entries = Object.entries(mcp as Record<string, unknown>);
  for (const [name, raw] of entries) {
    if (out.length >= MAX_SERVERS_PER_FILE) {
      errors.push({
        path: filePath,
        error: `more than ${MAX_SERVERS_PER_FILE} servers; truncating`,
      });
      break;
    }
    const projection = projectServerEntry(name, raw, source);
    if ('error' in projection) {
      errors.push({
        path: `${filePath}#${sanitizeKeyForErrorPath(name)}`,
        error: projection.error,
      });
      continue;
    }
    out.push(projection.meta);
  }
  return out;
}

/**
 * 一条 mcpServers 条目 → McpServerMeta。
 * 形态判断（与 Anthropic MCP 标准 + KodaX REPL 兼容）：
 *   { command, args?, env? }       → transport='stdio'
 *   { url } 或 { transport:'http' }→ transport='http'
 */
function projectServerEntry(
  name: string,
  raw: unknown,
  source: 'global' | 'project',
): { meta: McpServerMeta } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'server config must be an object' };
  }
  const cfg = raw as Record<string, unknown>;

  // envCount：env 字段是 object 时取 key 数；否则 0
  const envCount =
    cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.keys(cfg.env as Record<string, unknown>).length
      : 0;

  if (typeof cfg.url === 'string' && cfg.url.length > 0) {
    return {
      meta: {
        name,
        transport: 'http',
        url: cfg.url,
        envCount,
        source,
      },
    };
  }

  if (typeof cfg.command === 'string' && cfg.command.length > 0) {
    const args = Array.isArray(cfg.args)
      ? (cfg.args.filter((a) => typeof a === 'string') as string[])
      : undefined;
    return {
      meta: {
        name,
        transport: 'stdio',
        command: cfg.command,
        args,
        envCount,
        source,
      },
    };
  }

  return { error: 'server config has neither "command" nor "url"' };
}

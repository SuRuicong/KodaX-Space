// MCP config reader — v0.1.6 cleanup (global 走 SDK listMcpServers)
//
// 读 KodaX 的 user-level 和 project-level config，提取 mcpServers 字段：
//   ~/.kodax/config.json                — global，走 SDK 0.7.42 listMcpServers
//   ${projectRoot}/.kodax/config.json   — project，仍 Space 自己 parse
//                                          （SDK 不读 project config）
//
// 切到 SDK 的好处：
//   - 用户在 KodaX CLI 用 `kodax mcp add` 配的 server 在 Space 自动出现
//   - JSON parse + shape 验证 + 错误处理交给 SDK，Space 只做"展示投影"
//
// 安全（不变）：
//   - 文件不存在 → 不抛，返回空
//   - JSON 损坏 → errors 数组带 path + reason
//   - 不读 env value（可能含 secrets）；只暴露 envCount
//
// **Lazy load + DI**：sdk-repl.js 共享 chunk-ZZ4KRK2B（与 /coding 同），生产 runtime
// 已 hot；测试用 setMcpStoreImpl(mock) 注入避免 tsx/esm cli-boxes JSON bug。

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServerMeta } from '@kodax-space/space-ipc-schema';
import { readRegistry as readMcpbRegistry } from '../mcpb/registry.js';

type SdkReplModule = typeof import('@kodax-ai/kodax/repl');
type SdkMcpServersConfig = ReturnType<SdkReplModule['listMcpServers']>;

export interface McpStoreImpl {
  /** SDK listMcpServers — 返回 Record<name, McpServerConfig> for ~/.kodax/config.json */
  readonly listMcpServers: () => SdkMcpServersConfig;
}

let sdkModuleCache: SdkReplModule | null = null;
async function loadSdkReplModule(): Promise<SdkReplModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax/repl');
  }
  return sdkModuleCache;
}

const DEFAULT_IMPL: McpStoreImpl = {
  // 同步路径：cache hit 直接返回真 SDK，cache miss 返回空 + 触发异步 load。
  // 注：discoverMcpServers 走 ensureSdkReplModuleLoaded 异步预拉，所以正常路径不会命中 {}；
  // 此 {} fallback 仅给 prewarm 失败后的极端兜底用，不阻塞 IPC。
  listMcpServers: () => {
    if (sdkModuleCache === null) {
      void loadSdkReplModule(); // 触发 lazy load (不 await)
      return {};
    }
    return sdkModuleCache.listMcpServers();
  },
};

let activeImpl: McpStoreImpl = DEFAULT_IMPL;

/** 测试用：注入 mock。 */
export function setMcpStoreImpl(impl: McpStoreImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
}

/**
 * 异步确保 SDK 模块加载完——main.ts 启动后调一次让首次 IPC 不命中空 fallback。
 * 测试不调（DI 注入的 mock 不需要 SDK 模块）。
 */
export async function prewarmSdkMcpStore(): Promise<void> {
  if (sdkModuleCache !== null) return; // 已加载过
  try {
    await loadSdkReplModule();
  } catch (err) {
    // 加载失败不致命——下次 discoverMcpServers 会返回 SDK 端的空 + Space project parse
    console.warn('[mcp-config-reader] prewarm failed:', err instanceof Error ? err.message : err);
  }
}

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
 * 读 global (SDK) + project (Space 自己 parse) 的 mcpServers，合并返回。
 * 同名 server project 覆盖 global。
 *
 * **冷启动同步化**：discoverMcpServers 调用前先 await ensureSdkReplModuleLoaded()，
 * 防止 prewarm 还没完成就来 IPC 时 DEFAULT_IMPL 返回 {} 静默丢失 global server (reviewer HIGH-1)。
 * 测试通过 setMcpStoreImpl 注入 mock 跳过 SDK 加载——activeImpl !== DEFAULT_IMPL 时 await 直接 short-circuit。
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

  // 冷启动同步化：mock 注入 (test) 时直接 short-circuit；生产首次调用 await SDK chunk load
  if (activeImpl === DEFAULT_IMPL && sdkModuleCache === null) {
    try {
      await loadSdkReplModule();
    } catch (err) {
      errors.push({
        path: globalPath,
        error: `SDK load failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // global 走 SDK listMcpServers（KodaX CLI 配的 server 自动复用）
  const globalServers = readGlobalServersFromSdk(globalPath, errors);
  // project 仍 Space 自己 parse —— SDK 0.7.42 没暴露 project 级 config 读取
  const projectServers =
    path.resolve(projectPath) === path.resolve(globalPath)
      ? [] // 罕见但防御：projectRoot 恰好等于 globalDir
      : await readServersFromFile(projectPath, 'project', errors);

  // F021 mcpb 安装的 extension 也是 MCP server —— 投影成同样的 meta 形态
  const mcpbServers = await readMcpbServers(errors);

  const byName = new Map<string, McpServerMeta>();
  for (const s of mcpbServers) byName.set(s.name, s);
  for (const s of globalServers) byName.set(s.name, s); // global 覆盖 mcpb
  for (const s of projectServers) byName.set(s.name, s); // project 覆盖 all

  return { servers: [...byName.values()], errors };
}

async function readMcpbServers(
  errors: Array<{ path: string; error: string }>,
): Promise<McpServerMeta[]> {
  try {
    const reg = await readMcpbRegistry();
    return reg.extensions.map((ext) => ({
      name: ext.name,
      transport: 'stdio' as const,
      command: ext.server.command,
      ...(ext.server.args ? { args: ext.server.args } : {}),
      envCount: ext.server.env ? Object.keys(ext.server.env).length : 0,
      source: 'global' as const,
    }));
  } catch (err) {
    errors.push({
      path: '~/.kodax-space/mcpb-extensions.json',
      error: `mcpb registry read failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return [];
  }
}

/**
 * 从 SDK listMcpServers() 投影成 Space McpServerMeta[]，标 source='global'。
 * env 值不进 Meta（schema 也不允许）；只暴露 envCount。
 *
 * **错误对称**：项目级条目 shape 异常会进 errors[]（见 readServersFromFile）；
 * global 同样走 errors[]，否则用户看不到 SDK 端的坏 entry——reviewer MEDIUM-1。
 */
function readGlobalServersFromSdk(
  globalPath: string,
  errors: Array<{ path: string; error: string }>,
): McpServerMeta[] {
  const sdkConfig = activeImpl.listMcpServers();
  const out: McpServerMeta[] = [];
  // sdkConfig: Record<name, McpServerConfig>
  for (const [name, cfg] of Object.entries(sdkConfig)) {
    if (out.length >= MAX_SERVERS_PER_FILE) {
      errors.push({
        path: globalPath,
        error: `more than ${MAX_SERVERS_PER_FILE} servers; truncating`,
      });
      break;
    }
    const projection = projectSdkServerEntry(name, cfg as Record<string, unknown>, 'global');
    if (projection) {
      out.push(projection);
    } else {
      errors.push({
        path: `${globalPath}#${sanitizeKeyForErrorPath(name)}`,
        error: 'server config has neither "command" nor "url" (SDK shape unexpected)',
      });
    }
  }
  return out;
}

/**
 * SDK McpServerConfig → Space McpServerMeta。
 * SDK shape: { type?, command?, args?, url?, env?, cwd?, headers?, connect? }
 * Space 只保留展示需要的子集：name / transport / command / args / url / envCount / source
 */
function projectSdkServerEntry(
  name: string,
  cfg: Record<string, unknown>,
  source: 'global' | 'project',
): McpServerMeta | null {
  const envCount =
    cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.keys(cfg.env as Record<string, unknown>).length
      : 0;
  // url 优先（SDK 的 sse / streamable-http）
  if (typeof cfg.url === 'string' && cfg.url.length > 0) {
    return { name, transport: 'http', url: cfg.url, envCount, source };
  }
  if (typeof cfg.command === 'string' && cfg.command.length > 0) {
    const args = Array.isArray(cfg.args)
      ? (cfg.args.filter((a) => typeof a === 'string') as string[])
      : undefined;
    return { name, transport: 'stdio', command: cfg.command, args, envCount, source };
  }
  return null; // SDK 应当已 validate；caller (readGlobalServersFromSdk) 把 null 推到 errors[]
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

// MCP config reader.
//
// Sources:
// - global: ~/.kodax/config.json via SDK listMcpServers()
// - project: <projectRoot>/.kodax/config.json parsed locally
// - mcpb: ~/.kodax/mcpb/registry.json metadata for installed bundles
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { McpServerMeta } from '@kodax-space/space-ipc-schema';
import { readRegistry as readMcpbRegistry } from '../mcpb/registry.js';
import { getKodaxRuntimeDir } from '../kodax/data-paths.js';

type SdkReplModule = typeof import('@kodax-ai/kodax/repl');
type SdkMcpServersConfig = ReturnType<SdkReplModule['listMcpServers']>;

export interface McpStoreImpl {
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
  listMcpServers: () => {
    if (sdkModuleCache === null) {
      void loadSdkReplModule();
      return {};
    }
    return sdkModuleCache.listMcpServers();
  },
};

let activeImpl: McpStoreImpl = DEFAULT_IMPL;

export function setMcpStoreImpl(impl: McpStoreImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
}

export async function prewarmSdkMcpStore(): Promise<void> {
  if (sdkModuleCache !== null) return;
  try {
    await loadSdkReplModule();
  } catch (err) {
    console.warn('[mcp-config-reader] prewarm failed:', err instanceof Error ? err.message : err);
  }
}

const MAX_CONFIG_BYTES = 1_048_576;
const MAX_SERVERS_PER_FILE = 128;
const MAX_ERROR_KEY_LEN = 64;

function sanitizeKeyForErrorPath(name: string): string {
  const stripped = name.replace(/[\x00-\x1f\x7f]/g, '?');
  return stripped.length > MAX_ERROR_KEY_LEN ? `${stripped.slice(0, MAX_ERROR_KEY_LEN)}...` : stripped;
}

interface DiscoverOptions {
  readonly projectRoot: string;
  readonly kodaxGlobalDir?: string;
}

export interface DiscoverResult {
  readonly servers: McpServerMeta[];
  readonly errors: Array<{ path: string; error: string }>;
}

export async function discoverMcpServers(opts: DiscoverOptions): Promise<DiscoverResult> {
  if (!path.isAbsolute(opts.projectRoot)) {
    return {
      servers: [],
      errors: [{ path: opts.projectRoot, error: 'projectRoot must be absolute' }],
    };
  }

  const errors: Array<{ path: string; error: string }> = [];
  const globalDir = opts.kodaxGlobalDir ?? getKodaxRuntimeDir();
  const globalPath = path.join(globalDir, 'config.json');
  const projectPath = path.join(opts.projectRoot, '.kodax', 'config.json');

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

  const globalServers = readGlobalServersFromSdk(globalPath, errors);
  const projectServers =
    path.resolve(projectPath) === path.resolve(globalPath)
      ? []
      : await readServersFromFile(projectPath, 'project', errors);
  const mcpbServers = activeImpl === DEFAULT_IMPL ? await readMcpbServers(errors) : [];

  const byName = new Map<string, McpServerMeta>();
  for (const s of globalServers) byName.set(s.name, s);
  for (const s of mcpbServers) {
    const existing = byName.get(s.name);
    if (!existing || sameMcpProjection(existing, s)) {
      byName.set(s.name, s);
    }
  }
  for (const s of projectServers) byName.set(s.name, s);

  return { servers: [...byName.values()], errors };
}

function sameMcpProjection(a: McpServerMeta, b: McpServerMeta): boolean {
  return (
    a.transport === b.transport &&
    a.command === b.command &&
    a.url === b.url &&
    a.envCount === b.envCount &&
    arrayEqual(a.args ?? [], b.args ?? [])
  );
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

async function readMcpbServers(errors: Array<{ path: string; error: string }>): Promise<McpServerMeta[]> {
  try {
    const reg = await readMcpbRegistry();
    return reg.extensions.map((ext) => ({
      name: ext.name,
      transport: 'stdio' as const,
      command: ext.server.command,
      ...(ext.server.args ? { args: ext.server.args } : {}),
      envCount: ext.server.env ? Object.keys(ext.server.env).length : 0,
      source: 'mcpb' as const,
    }));
  } catch (err) {
    errors.push({
      path: '~/.kodax/mcpb/registry.json',
      error: `mcpb registry read failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return [];
  }
}

function readGlobalServersFromSdk(
  globalPath: string,
  errors: Array<{ path: string; error: string }>,
): McpServerMeta[] {
  const sdkConfig = activeImpl.listMcpServers();
  const out: McpServerMeta[] = [];
  for (const [name, cfg] of Object.entries(sdkConfig)) {
    if (out.length >= MAX_SERVERS_PER_FILE) {
      errors.push({ path: globalPath, error: `more than ${MAX_SERVERS_PER_FILE} servers; truncating` });
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

function projectSdkServerEntry(
  name: string,
  cfg: Record<string, unknown>,
  source: 'global' | 'project',
): McpServerMeta | null {
  const envCount =
    cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.keys(cfg.env as Record<string, unknown>).length
      : 0;
  if (typeof cfg.url === 'string' && cfg.url.length > 0) {
    return { name, transport: 'http', url: cfg.url, envCount, source };
  }
  if (typeof cfg.command === 'string' && cfg.command.length > 0) {
    const args = Array.isArray(cfg.args)
      ? (cfg.args.filter((a) => typeof a === 'string') as string[])
      : undefined;
    return { name, transport: 'stdio', command: cfg.command, args, envCount, source };
  }
  return null;
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
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    errors.push({ path: filePath, error: `read failed: ${(err as Error).message ?? String(err)}` });
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
  if (mcp === undefined) return [];
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) {
    errors.push({ path: filePath, error: 'mcpServers must be a JSON object' });
    return [];
  }

  const out: McpServerMeta[] = [];
  for (const [name, raw] of Object.entries(mcp as Record<string, unknown>)) {
    if (out.length >= MAX_SERVERS_PER_FILE) {
      errors.push({ path: filePath, error: `more than ${MAX_SERVERS_PER_FILE} servers; truncating` });
      break;
    }
    const projection = projectServerEntry(name, raw, source);
    if ('error' in projection) {
      errors.push({ path: `${filePath}#${sanitizeKeyForErrorPath(name)}`, error: projection.error });
      continue;
    }
    out.push(projection.meta);
  }
  return out;
}

function projectServerEntry(
  name: string,
  raw: unknown,
  source: 'global' | 'project',
): { meta: McpServerMeta } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'server config must be an object' };
  }
  const cfg = raw as Record<string, unknown>;
  const envCount =
    cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.keys(cfg.env as Record<string, unknown>).length
      : 0;

  if (typeof cfg.url === 'string' && cfg.url.length > 0) {
    return { meta: { name, transport: 'http', url: cfg.url, envCount, source } };
  }
  if (typeof cfg.command === 'string' && cfg.command.length > 0) {
    const args = Array.isArray(cfg.args)
      ? (cfg.args.filter((a) => typeof a === 'string') as string[])
      : undefined;
    return { meta: { name, transport: 'stdio', command: cfg.command, args, envCount, source } };
  }

  return { error: 'server config has neither "command" nor "url"' };
}

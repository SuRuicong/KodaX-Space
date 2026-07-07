import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getKodaxRuntimeDir } from '../kodax/data-paths.js';

// Loads KodaX MCP config for McpManager and the SDK extension runtime.
//
// This differs from mcp/config-reader.ts: that path returns projected McpServerMeta[]
// for mcp.discover and strips env values. This path returns raw SDK McpServersConfig,
// preserving command / args / env / url / headers so transports can actually start.
//
// loadKodaxUserConfig() follows the SDK global path: ~/.kodax/config.json.
// loadKodaxMcpServersForProject() additionally merges project .kodax/config.json for agent runtime.

type SdkRootModule = typeof import('@kodax-ai/kodax');
type McpServersConfig = NonNullable<ReturnType<SdkRootModule['loadConfig']>['mcpServers']>;

let sdkRootCache: SdkRootModule | null = null;
const MAX_PROJECT_CONFIG_BYTES = 1_048_576;

/** lazy 加载 KodaX root module — loadConfig() 在那里,fast-path cached after first call。*/
async function loadSdkRoot(): Promise<SdkRootModule> {
  if (sdkRootCache === null) {
    sdkRootCache = await import('@kodax-ai/kodax');
  }
  return sdkRootCache;
}

/**
 * 拿全套 mcpServers config (没读到 / 无配置则返回 undefined,McpManager 接受 undefined)。
 * 失败 (config.json 损坏 / SDK 加载错) 抛错,由 getMcpManager 的 catch 路径处理。
 */
export async function loadKodaxUserConfig(): Promise<McpServersConfig | undefined> {
  const sdk = await loadSdkRoot();
  const raw = sdk.loadConfig();
  const ms = raw.mcpServers;
  if (!ms || typeof ms !== 'object') return undefined;
  return ms as McpServersConfig;
}


export async function loadKodaxProjectMcpServers(
  projectRoot: string,
): Promise<McpServersConfig | undefined> {
  if (!path.isAbsolute(projectRoot)) return undefined;

  const projectPath = path.join(projectRoot, '.kodax', 'config.json');
  const globalPath = path.join(getKodaxRuntimeDir(), 'config.json');
  if (path.resolve(projectPath) === path.resolve(globalPath)) return undefined;

  let text: string;
  try {
    const stat = await fsp.stat(projectPath);
    if (!stat.isFile() || stat.size > MAX_PROJECT_CONFIG_BYTES) return undefined;
    text = await fsp.readFile(projectPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('project .kodax/config.json contains invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const mcpServers = (parsed as Record<string, unknown>).mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return undefined;
  return mcpServers as McpServersConfig;
}

export async function loadKodaxMcpServersForProject(
  projectRoot: string,
): Promise<McpServersConfig | undefined> {
  const [globalServers, projectServers] = await Promise.all([
    loadKodaxUserConfig().catch((err) => {
      console.warn(
        '[kodax-user-config] global MCP config ignored:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }),
    loadKodaxProjectMcpServers(projectRoot).catch((err) => {
      console.warn(
        '[kodax-user-config] project MCP config ignored:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }),
  ]);

  if (!globalServers) return projectServers;
  if (!projectServers) return globalServers;
  return { ...globalServers, ...projectServers } as McpServersConfig;
}

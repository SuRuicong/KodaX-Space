// 拿 KodaX user config 的 mcpServers (~/.kodax/config.json) — 给 McpManager 用
//
// 跟 mcp/config-reader.ts 是不同的入口: 那个返回 Space McpServerMeta[] 给 mcp.discover IPC
// 投影展示用,丢弃 env value; 这里返回**原汁原味的 SDK McpServersConfig**,因为 McpManager
// 真要起子进程 / 连 sse,需要 command / args / env / url / headers 全套。
//
// 路径与 SDK 一致: ~/.kodax/config.json (从 KodaX root export 的 loadConfig);
// 不读 project-level — McpManager 当前只接全局配置,project-level 留 v0.1.x+。

type SdkRootModule = typeof import('@kodax-ai/kodax');
type McpServersConfig = NonNullable<ReturnType<SdkRootModule['loadConfig']>['mcpServers']>;

let sdkRootCache: SdkRootModule | null = null;

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

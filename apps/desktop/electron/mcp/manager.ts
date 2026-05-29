// MCP Manager singleton — v0.1.x (Batch 3 #5 deferred → 此处补回)
//
// 一份 McpManager 实例由 main 进程 lazy 持有,给 mcp.servers / mcp.start / mcp.stop /
// mcp.logs / mcp.tools / mcp.reload IPC handlers 用。设计要点:
//
//   1. **不与 KodaX runtime 共享**: KodaX 的 runKodaX 自己实例化一份 MCP capability
//      provider, 跟这里的 Manager 完全独立。原因: runtime 那份配置和生命周期跟某个 prompt
//      绑定 (run 完就 dispose),Space popout 需要长期持有 + listServers/start/stop 的
//      lifecycle API,语义对不上。SDK 文档明确说 "popout 自己构造一个 manager"。
//
//   2. **配置来源**: KodaX SDK 的 loadConfig().mcpServers (~/.kodax/config.json),与
//      KodaX CLI / runtime 完全一致 — 用户在 CLI 用 `kodax mcp add` 配的 server 自动出现。
//      Space project-level (<project>/.kodax/config.json) 暂不接入: McpManager 当前不支持
//      per-project scope,要追加得自己 merge config,留 v0.1.x+ feature。
//
//   3. **Reload 语义**: dispose() + 重新构造。用户改 config.json 后点 "Reload" 触发。
//      v1 不监听 config.json 文件变化 (file watcher 会引入 main 端 fs.watch 依赖),
//      用户主动点 reload 是简单一致的语义。
//
//   4. **Lazy 启动**: 第一次调任何 list/start/stop 时才 dynamic import SDK + 创建 Manager。
//      之后所有 IPC 调用零开销。失败时 unhealthyError 缓存,下次 IPC 收到清晰的错误消息。

import { loadKodaxUserConfig } from './kodax-user-config-loader.js';

type AgentMcpModule = typeof import('@kodax-ai/kodax/mcp');
type ManagerInstance = InstanceType<AgentMcpModule['McpManager']>;

let cached: {
  module: AgentMcpModule;
  manager: ManagerInstance;
} | null = null;
let lastConstructError: string | null = null;
// In-flight init promise — 第一次 IPC 触发 import + new McpManager 时两个 await 之间会让出
// event loop,后续并发 IPC 调用如果只检查 cached !== null 会全部漏过 guard,各自 new 一个 manager
// 出来,前面那个就被 cached 覆盖丢失 (其 stdio child 进程留作 zombie)。用一个 initPromise 串行
// 所有并发首调 (审查 HIGH)。
let initPromise: Promise<ManagerInstance> | null = null;

/**
 * 拿当前 Manager 实例; 缓存命中直接返回, 没有则 lazy 创建。
 * 第一次失败的 error 被缓存; reload() 调用清掉允许重试。
 */
export async function getMcpManager(): Promise<ManagerInstance> {
  if (cached !== null) return cached.manager;
  if (lastConstructError !== null) {
    throw new Error(`McpManager unavailable: ${lastConstructError}`);
  }
  if (initPromise !== null) return initPromise;
  initPromise = (async (): Promise<ManagerInstance> => {
    try {
      const mod = await import('@kodax-ai/kodax/mcp');
      const servers = await loadKodaxUserConfig().catch(() => undefined);
      const manager = new mod.McpManager(servers);
      cached = { module: mod, manager };
      return manager;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastConstructError = msg;
      throw new Error(`McpManager init failed: ${msg}`);
    } finally {
      // 清掉 in-flight 引用,允许 reload 后下次从头来过
      initPromise = null;
    }
  })();
  return initPromise;
}

/**
 * 用户改 config.json 后调: dispose 现 Manager + 清缓存。下一次 getMcpManager() 会用最新配置
 * 重新构造。dispose 失败也清缓存 (SDK 文档说 dispose 后实例不可用)。
 */
export async function reloadMcpManager(): Promise<void> {
  const prev = cached;
  cached = null;
  lastConstructError = null;
  // 同时清掉 initPromise — 如果 reload 在初次 init 还没 resolve 时被调,旧 init 完成后会被
  // finally 里的 `initPromise = null` 自然清掉; 但 reload 走在前面时显式清避免被 prev 覆盖。
  initPromise = null;
  if (prev !== null) {
    try {
      await prev.manager.dispose();
    } catch {
      /* 即便 dispose 失败,prev 实例已被丢弃,下次 getMcpManager 会创建新的 */
    }
  }
}

/**
 * 进程退出时调 — 释放 stdio transport 子进程等。
 * Space main.ts before-quit 钩子调。失败仅 log,不阻塞退出。
 */
export async function disposeMcpManager(): Promise<void> {
  if (cached === null) return;
  const prev = cached;
  cached = null;
  try {
    await prev.manager.dispose();
  } catch {
    /* swallow */
  }
}

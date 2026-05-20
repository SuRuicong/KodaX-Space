// MCP discovery channel — FEATURE_036 (read-only, alpha.1).
//
// 完整设计要 list 配置 + start/stop/log/tool-catalog (F036 设计文档)，但 KodaX SDK 0.7.40
// 公开 surface 没出 MCP 管理 API（`/mcp` 是 REPL-internal，SDK 不暴露 capability provider）。
// alpha.1 先做"读 ~/.kodax/config.json mcpServers 字段并展示"——只读列表，不动 server 生命周期。
// 完整版（启停/日志/工具目录）在 v0.1.7 F039 接 SDK 后做（与 F038 同模式）。

import { z } from 'zod';

// MCP transport 类型：stdio (本地子进程) / http (sse/streamable HTTP)
// KodaX 用户配置文件兼容 Anthropic MCP 标准格式
const mcpTransportSchema = z.enum(['stdio', 'http']);

// 单个 MCP server 配置投影 (Space 端关心的字段子集)。
// 不暴露 env 内容——环境变量可能含 secrets，main 端 redact 后再传 renderer。
const mcpServerMetaSchema = z.object({
  /** Server name (mcpServers 对象的 key) */
  name: z.string().min(1).max(128),
  transport: mcpTransportSchema,
  /** stdio: 命令。例 'npx' / 'python' / 绝对路径 */
  command: z.string().max(2048).optional(),
  /** stdio: 命令参数 */
  args: z.array(z.string().max(2048)).max(64).optional(),
  /** http: 完整 URL (https/sse) */
  url: z.string().max(2048).optional(),
  /** Env var 个数 (不暴露 key/value，只计数，让用户知道这个 server 用了多少 env) */
  envCount: z.number().int().nonnegative().max(1024),
  /** 配置来源：global ~/.kodax/config.json 或 project ${projectRoot}/.kodax/config.json */
  source: z.enum(['global', 'project']),
});

// ---- Invoke: mcp.discover ----
//
// 拉当前 session.projectRoot 对应的 MCP server 列表 (global + project 合并；同名 project 覆盖 global)。
// 每次走 disk read——KodaX REPL 改完 config.json 后立刻在 desktop popout 生效。
export const mcpDiscoverChannel = {
  name: 'mcp.discover',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    servers: z.array(mcpServerMetaSchema).max(128),
    /** 解析过程中跳过的错误（损坏 JSON / shape 不对的 server 条目），UI 给用户提示 */
    errors: z.array(
      z.object({
        // 通常是 ~/.kodax/config.json 或 ${root}/.kodax/config.json[#sanitized-name]
        // 文件系统路径上限保守取 1024（兼容 Windows 长路径 + #name 后缀），不暴露其他来源
        path: z.string().max(1024),
        error: z.string().max(512),
      }),
    ).max(32),
  }),
} as const;

export type McpServerMeta = z.infer<typeof mcpServerMetaSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;

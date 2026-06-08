// .mcpb (Desktop Extension) bundle install channels — F021 (v0.1.3)
//
// Anthropic 的 .mcpb / .dxt 格式：zip 包含 manifest.json + server 文件，main 解压到
// ~/.kodax-space/mcpb/<name>-<version>/ 然后让 Space MCP discovery 把它当一个用户
// 配置的 MCP server。
//
// 安全（详 docs/ADR/ADR-???）：
//   - 解压前用 zip-slip 检测每个 entry path（'..' / 绝对路径 / Windows drive 字母）
//   - manifest 走严格 zod schema，未知字段忽略但必需字段缺失立即 reject
//   - server.command / args 不直接 exec，写到 ~/.kodax-space/mcpb-extensions.json
//     然后由 Space 的 MCP manager 启动（与用户手配的 server 同 sandbox）
//   - filePath 入参不校验 path normalization —— main 端 IPC handler 用 path.resolve
//     + 拒绝 traversal
//
// 不暴露给 renderer：
//   - server.env 的 value（可能包含 API key / token）
//   - 完整 manifest 原文（含 author email 等 metadata）
//   - 安装目录绝对路径（OS 用户名 leak）

import { z } from 'zod';

const semverSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z.+-]+$/, 'invalid semver');

const mcpbExtensionSchema = z.object({
  /** main 派的 id：`${name}@${version}`，用作 uninstall key */
  extensionId: z.string().min(1).max(256),
  /** manifest.name —— kebab-case 推荐，最长 128 */
  name: z.string().min(1).max(128),
  /** manifest.display_name —— UI 显示用，未提供 fallback 到 name */
  displayName: z.string().min(1).max(128),
  /** manifest.version（semver-ish） */
  version: semverSchema,
  /** manifest.description —— 截到 280 */
  description: z.string().max(280).optional(),
  /** manifest.author.name —— 不暴露 email / url */
  author: z.string().max(128).optional(),
  /** server.type（stdio / http），便于 UI 显示 transport icon */
  transport: z.enum(['stdio', 'http']),
  /** server tool count（manifest.tools.length），UI 显示用 */
  toolCount: z.number().int().min(0).max(1024),
  /** install 时刻的 epoch ms，让 UI 排序 "最近安装的" */
  installedAt: z.number().int().min(0),
});

export type McpbExtensionT = z.infer<typeof mcpbExtensionSchema>;

export const mcpbInstallChannel = {
  name: 'mcpb.install',
  direction: 'invoke',
  input: z.object({
    /** .mcpb 文件绝对路径；不传时 main 用 dialog.showOpenDialog 让用户选 */
    filePath: z.string().min(1).max(4096).optional(),
  }),
  output: z.union([
    z.object({
      extension: mcpbExtensionSchema,
      cancelled: z.literal(false).optional(),
    }),
    z.object({
      /** 用户在 dialog 里按 Cancel —— 不是错误，UI 静默 */
      cancelled: z.literal(true),
    }),
  ]),
} as const;

export const mcpbUninstallChannel = {
  name: 'mcpb.uninstall',
  direction: 'invoke',
  input: z.object({
    extensionId: z.string().min(1).max(256),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

export const mcpbListChannel = {
  name: 'mcpb.list',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: z.object({
    extensions: z.array(mcpbExtensionSchema).max(512),
  }),
} as const;

/** install / uninstall 后 main → renderer 推一次，让 UI 不轮询也能刷新 */
export const mcpbChangedChannel = {
  name: 'mcpb.changed',
  direction: 'push',
  payload: z.object({
    extensions: z.array(mcpbExtensionSchema).max(512),
  }),
} as const;

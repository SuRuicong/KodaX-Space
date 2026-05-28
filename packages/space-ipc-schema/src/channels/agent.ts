// Markdown agent discovery channel — FEATURE_197 (KodaX 0.7.43).
//
// KodaX 在 session 启动时通过 loadAgentsFromMarkdown(cwd) 自动扫 ~/.kodax/agents/*.md
// 和 <project>/.kodax/agents/*.md 并注册到 agent registry——这是 V2 chain dispatch
// 的隐式数据源。discoverMarkdownAgents 是 v0.7.43 新加的纯只读 API（不 admit、不写
// registry），供 host UI 做 agent picker / debug 面板用。
//
// Space wire 思路对齐 skill.discover：renderer 拿到 metadata 列表 → 渲染为 picker /
// AGENTS.md popout 的子标签；不在 main 端直接做"激活"，激活仍由 KodaX session
// 启动期自己做。

import { z } from 'zod';

// Markdown agent 来源——严格 mirror SDK DiscoveredMarkdownAgent.source 联合。
const agentSourceSchema = z.enum(['markdown:user', 'markdown:project']);

// Agent 元数据（discover 输出）。所有上限对齐 skill.discover 同类字段。
const agentMetaSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/, {
      message: 'agent name must be kebab-case (allow . : _ -)',
    })
    .min(1)
    .max(64),
  description: z.string().max(2048),
  source: agentSourceSchema,
  /** 源 markdown 文件绝对路径。给 UI "在 OS 里定位" / tooltip 用。*/
  path: z.string().min(1).max(4096),
  /** frontmatter `tools` 数组（SDK 返回的是用户原始名字，不带 builtin: 前缀）。 */
  tools: z.array(z.string().min(1).max(128)).max(64).optional(),
  /** frontmatter `model` alias，可选。 */
  model: z.string().max(128).optional(),
});

// 校验失败的 markdown 文件。reason 上限给宽点——SDK 可能给整段 yaml parse error。
const agentFailureSchema = z.object({
  path: z.string().min(1).max(4096),
  reason: z.string().max(2048),
});

// ---- Invoke: agent.discover ----
//
// 输入 projectRoot 而不是 sessionId——KodaX session 启动前 picker 就该能列；如果绑
// sessionId 就强制必须先 create session。projectRoot 跟 skill.discover 借助
// kodaxHost.get(sid).projectRoot 拿到的值同源。
export const agentDiscoverChannel = {
  name: 'agent.discover',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
  }),
  output: z.object({
    /** Markdown agent metadata。256 上限对齐 skill.discover 同类 cap。*/
    agents: z.array(agentMetaSchema).max(256),
    /** 失败文件列表——给 picker 上展示 "1 agent failed to load" 警告用。 */
    failed: z.array(agentFailureSchema).max(256),
  }),
} as const;

export type AgentMeta = z.infer<typeof agentMetaSchema>;
export type AgentSource = z.infer<typeof agentSourceSchema>;
export type AgentFailure = z.infer<typeof agentFailureSchema>;

// Skill discovery + invocation channels — FEATURE_035.
//
// KodaX skill 体系（user-/project-/plugin-/builtin-level SKILL.md frontmatter 注册）。
// Space wire：
//   - skill.discover  → 列已注册的 user-invocable skill（meta only，不读 full body）
//   - skill.invoke    → 拿 args，main 端用 VariableResolver 解析 SKILL.md body 里
//                      $1/${VAR}/$ARGUMENTS/!`cmd`，返回 resolvedPrompt 给 renderer。
//                      renderer 再走 session.send 把 prompt 喂给 KodaX——
//                      让用户在 conversation stream 里看到这条 prompt。
//
// 不让 main 端直接 session.send 是因为：UI 还要展示"用户发了 /<skill> args"这条记录，
// renderer 需要参与 appendUserMessage。把 resolve + send 分两段保持职责单一。

import { z } from 'zod';

// Skill 来源：跟 SDK SkillSource 严格对齐
const skillSourceSchema = z.enum(['user', 'project', 'plugin', 'builtin']);

// Skill 元数据（discover 输出）。description 上限同 slash command。
const skillMetaSchema = z.object({
  name: z.string()
    .regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/, {
      message: 'skill name must be kebab-case (allow . : _ -)',
    })
    .min(1)
    .max(64),
  description: z.string().max(512),
  /** 参数提示，如 '<filename>'。可空。*/
  argumentHint: z.string().max(128).optional(),
  source: skillSourceSchema,
  /** 已 discover 的 SKILL.md 绝对路径。用于"locate in OS"功能 + popover tooltip。*/
  path: z.string().min(1).max(4096),
});

// ---- Invoke: skill.discover ----
export const skillDiscoverChannel = {
  name: 'skill.discover',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
  }),
  output: z.object({
    /** 最多 256 个 skill / project root—— 防 path traversal 误注册大量产物。*/
    skills: z.array(skillMetaSchema).max(256),
  }),
} as const;

// ---- Invoke: skill.invoke ----
//
// main 端拿 name + args → SkillRegistry.invoke 返回 SkillInvokeResult，
// success → { ok:true, resolvedPrompt }，
// !success → { ok:false, error:string }
//
// args 与 slash.exec args 上限对齐 (max 20 strings @ 2048 char)，单 prompt 上限 1MB
// 在 session.send 处由 sessionSendChannel 把守，这里不重复 cap。
export const skillInvokeChannel = {
  name: 'skill.invoke',
  direction: 'invoke',
  input: z.object({
    sessionId: z.string().min(1),
    skillName: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/).min(1).max(64),
    args: z.array(z.string().max(2048)).max(20),
  }),
  output: z.object({
    ok: z.boolean(),
    /** 仅 ok:true 有 — 已经 resolve $VAR / $ARGUMENTS / !`cmd` 的完整 prompt 文本。 */
    resolvedPrompt: z.string().max(1_048_576).optional(),
    /** 仅 ok:false 有 — user-displayable 失败原因（SKILL.md 解析失败 / model invocation disabled / ... ） */
    error: z.string().max(2048).optional(),
  }),
} as const;

export type SkillMeta = z.infer<typeof skillMetaSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;

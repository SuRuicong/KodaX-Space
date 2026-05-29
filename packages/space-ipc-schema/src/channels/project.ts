// Project management channels — FEATURE_005.
//
// Project = 用户在 Space 里"打开"的工作目录（一般是 git root）。
// 持久化到 ~/.kodax/space/projects.json（main 端 store），UI 提供 picker / recent list。
//
// Renderer **永远不**直接把任意路径传给 main 持久化——project.openDialog 包了 main 端
// dialog.showOpenDialog，只允许用户通过原生 picker 选；project.recent.add 接收的 path
// 已经经过 validateProjectRoot 路径形态校验。

import { z } from 'zod';

const projectSchema = z.object({
  path: z.string().min(1).max(4096), // 路径长度上限——再长八成不是真路径
  name: z.string().min(1).max(256), // 显示名（默认取 path basename，未来可允许用户改）
  addedAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative(),
});

export type Project = z.infer<typeof projectSchema>;

// ---- project.list ----
export const projectListChannel = {
  name: 'project.list',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    projects: z.array(projectSchema),
  }),
} as const;

// ---- project.openDialog ----
//
// main 端调 dialog.showOpenDialog({ properties: ['openDirectory'] })。
// 返回用户选中的 path（已经是绝对路径，OS dialog 保证），或 null 表示用户取消。
// 这是 renderer 拿到合法 path 的**唯一**途径——不允许 renderer 凭空输入路径写进 recent。
export const projectOpenDialogChannel = {
  name: 'project.openDialog',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    path: z.string().min(1).max(4096).nullable(),
  }),
} as const;

// ---- project.recent.add ----
export const projectRecentAddChannel = {
  name: 'project.recent.add',
  direction: 'invoke',
  input: z.object({
    path: z.string().min(1).max(4096),
  }),
  output: z.object({
    project: projectSchema,
  }),
} as const;

// ---- project.recent.remove ----
export const projectRecentRemoveChannel = {
  name: 'project.recent.remove',
  direction: 'invoke',
  input: z.object({
    path: z.string().min(1).max(4096),
  }),
  output: z.object({
    removed: z.boolean(),
  }),
} as const;

// ---- project.gitStats ----
//
// 读 `git log` + `git shortlog` 聚合一段时间内的 commit / churn / 每日活跃度。
// main 端用 child_process 跑 git binary——不引入 simple-git 依赖（avoid +30MB deps）。
// 超时 5s，非 git repo / 不可执行直接返回 ok:true + 全 0（让 dashboard 平和 fallback）。
const dailyCommitSchema = z.object({
  date: z.string().min(10).max(10), // YYYY-MM-DD
  count: z.number().int().nonnegative(),
});

export const projectGitStatsChannel = {
  name: 'project.gitStats',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
    /** 时间范围（天）。null = all-time。 */
    sinceDays: z.number().int().positive().max(3650).nullable(),
  }),
  output: z.object({
    /** 是否真的是 git repo（false 时其它字段为 0）。 */
    isGitRepo: z.boolean(),
    /** 范围内 commit 数。*/
    commits: z.number().int().nonnegative(),
    /** 范围内不重复改动文件数（git log --name-only 去重）。*/
    filesChanged: z.number().int().nonnegative(),
    /** 范围内累计新增行数。 */
    linesAdded: z.number().int().nonnegative(),
    /** 范围内累计删除行数。 */
    linesDeleted: z.number().int().nonnegative(),
    /** 范围内活跃 author 数 (按 email 去重)。 */
    contributors: z.number().int().nonnegative(),
    /** 每日 commit 直方图（YYYY-MM-DD → count）。给 dashboard 热力图叠加用，最多 365 条。*/
    dailyCommits: z.array(dailyCommitSchema).max(365),
    /** 当前 HEAD 分支名（detached 时返回 'HEAD'）。 */
    currentBranch: z.string().max(256).nullable(),
  }),
} as const;

export type ProjectGitStatsDaily = z.infer<typeof dailyCommitSchema>;

// ---- project.fileSearch ----
//
// 模糊匹配 project root 下的文件路径,给 BottomBar 的 @path autocomplete 用 (REPL
// SuggestionsDisplay 等价)。
//
// 实现策略 (main 端):
//   - 启动期 lazy 扫: 每个 project 第一次查询时 walk projectRoot 收集相对路径,filter
//     掉 node_modules / .git / dist / build 等 (heuristics + .gitignore basic patterns)。
//     结果存 module-level cache + 30s TTL,后续命中 cache 立即返回。
//   - 单次扫上限 50_000 文件 (大 monorepo 防内存炸),超出截断。
//   - query 是简单 substring (case-insensitive)。subsequence/fuzzy 后续优化。
//
// **不返回内容**: 只回相对路径 (raw string)。文件读还是走 files.read。
// **不暴露绝对路径**: 隐私 (用户 home dir 等) + UI 简洁 (@src/foo.ts 比绝对路径短)。
export const projectFileSearchChannel = {
  name: 'project.fileSearch',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
    /** 子串查询;空串 → 返回前 limit 条文件 (用于刚打 `@` 还没输文字时弹个清单) */
    query: z.string().max(512),
    /** 默认 30 条,popover 显示足够 */
    limit: z.number().int().positive().max(100).optional(),
  }),
  output: z.object({
    /** posix 风格相对路径,如 'src/foo/bar.ts' */
    paths: z.array(z.string().min(1).max(2048)).max(100),
    /** 是否截断 — true 表示还有更多匹配未返回,UI 显示"+N more" hint */
    truncated: z.boolean(),
  }),
} as const;

// ---- project.gitStatus ----
//
// 实时读 git working tree 脏度,给 BottomBar 上的 StashNotice 用 (REPL TUI 同款功能):
// 工作区有未提交改动时显示一条"N modified · M untracked"的提示行,避免用户在 dirty 仓库里
// 误启动 KodaX 跑 task 把变更覆盖掉。轻量 — 单次 `git status --porcelain -b` 调用,~10-30ms。
//
// 缓存策略: main 端 module-level mtime + 5s TTL (同 gitStats),renderer 频繁切场景不会撞 git。
//
// **不**返回文件路径列表 (DoS guard + 隐私): 只回计数 + branch 名,避免 leak file structure 到 renderer。
export const projectGitStatusChannel = {
  name: 'project.gitStatus',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096),
  }),
  output: z.object({
    /** false = 非 git repo / git 不可用 / projectRoot 不存在等。 */
    isGitRepo: z.boolean(),
    /** modified + staged + untracked > 0 → 工作区 dirty (UI 弹 StashNotice 条件)。 */
    dirty: z.boolean(),
    /** Modified (worktree 修改未 staged) 文件数。 */
    modifiedCount: z.number().int().nonnegative(),
    /** Staged (已 git add 等待 commit) 文件数。 */
    stagedCount: z.number().int().nonnegative(),
    /** Untracked (未 git add 也未 .gitignore) 文件数。 */
    untrackedCount: z.number().int().nonnegative(),
    /** 当前分支名 (detached HEAD 时返回 'HEAD' 或短 SHA)。 */
    branch: z.string().max(256).nullable(),
    /** main/master 上游的领先 / 落后 commit 数 (无上游时 undefined)。 */
    ahead: z.number().int().nonnegative().optional(),
    behind: z.number().int().nonnegative().optional(),
  }),
} as const;

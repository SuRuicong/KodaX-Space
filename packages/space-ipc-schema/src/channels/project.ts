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

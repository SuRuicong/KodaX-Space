// Space user-level settings channels — alpha.1
//
// 只走标量；secrets/API keys 通过 provider.setKey 走 keychain。
//
// 当前 surface：
//   - settings.get → 拿全部当前设置
//   - settings.setDefaultWorkspace { path } → 改默认 workspace + ensureExists 一次

import { z } from 'zod';

const spaceSettingsSchema = z.object({
  defaultWorkspace: z.string().min(1).max(4096),
});

export type SpaceSettingsT = z.infer<typeof spaceSettingsSchema>;

export const settingsGetChannel = {
  name: 'settings.get',
  direction: 'invoke',
  input: z.object({}).strict(),
  output: spaceSettingsSchema,
} as const;

export const settingsSetDefaultWorkspaceChannel = {
  name: 'settings.setDefaultWorkspace',
  direction: 'invoke',
  input: z.object({
    path: z.string().min(1).max(4096),
  }),
  output: spaceSettingsSchema,
} as const;

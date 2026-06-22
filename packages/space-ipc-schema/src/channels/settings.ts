// Space user-level settings channels — alpha.1
//
// 只走标量；secrets/API keys 通过 provider.setKey 走 keychain。
//
// 当前 surface：
//   - settings.get → 拿全部当前设置
//   - settings.setDefaultWorkspace { path } → 改默认 workspace + ensureExists 一次

import { z } from 'zod';

export const supportedLocaleSchema = z.enum(['zh-CN', 'en-US']);
export type SupportedLocaleT = z.infer<typeof supportedLocaleSchema>;

export const languageModeSchema = z.enum(['system', 'zh-CN', 'en-US']);
export type LanguageModeT = z.infer<typeof languageModeSchema>;

export function resolveEffectiveLocale(
  languageMode: LanguageModeT,
  preferredLanguages: readonly string[],
): SupportedLocaleT {
  if (languageMode === 'zh-CN' || languageMode === 'en-US') return languageMode;

  for (const raw of preferredLanguages) {
    const value = raw.trim().toLowerCase();
    if (value === '' || value === 'c' || value === 'posix') continue;
    if (
      value === 'zh-cn' ||
      value === 'zh-hans' ||
      value.startsWith('zh-cn-') ||
      value.startsWith('zh-hans-')
    ) {
      return 'zh-CN';
    }
    if (value === 'zh') return 'zh-CN';
  }

  return 'en-US';
}

const spaceSettingsSchema = z.object({
  defaultWorkspace: z.string().min(1).max(4096),
  languageMode: languageModeSchema,
  effectiveLocale: supportedLocaleSchema,
  preferredSystemLanguages: z.array(z.string().min(1).max(128)),
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

export const settingsSetLanguageModeChannel = {
  name: 'settings.setLanguageMode',
  direction: 'invoke',
  input: z.object({
    languageMode: languageModeSchema,
  }),
  output: spaceSettingsSchema,
} as const;

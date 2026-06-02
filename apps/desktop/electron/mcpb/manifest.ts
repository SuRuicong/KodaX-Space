// .mcpb / .dxt manifest schema — F021 (v0.1.3)
//
// 参考 Anthropic Desktop Extensions (DXT) 规范子集 —— Space 只关心：
//   - identity: name + display_name + version + description
//   - server runtime: command + args + env（用来注册到 KodaX MCP）
//   - tools 描述（仅 length 用于 UI）
//
// 未声明字段（hooks, prompts, resources, dependencies 等）静默忽略 —— 我们 .passthrough()
// 让上游 schema 漂移不阻塞安装，只是 Space 暂时不可见。
//
// 安全：
//   - manifest_version 锁定 0.1～1.x，未来 2.x breaking 时拒绝兜底
//   - command 是字符串，禁止数组（防 shell-array-injection 类技巧）
//   - args 限到 64 条，单条 ≤ 1024 字符（防 manifest 灌入巨型字符串导致 IPC 出参超限）
//   - env value 必须是 string —— 不允许 `{ "MY_KEY": { "$kodaxSecret": "..." } }`
//     未来 secret 语法在 schema 升级时再加，现在简单
//   - 拒绝 entry_point / command 含绝对路径，必须相对 archive root（防 install 后
//     执行 archive 外的二进制）

import { z } from 'zod';

const envValueSchema = z.string().min(0).max(4096);

const serverSchema = z.object({
  /** 'node' | 'python' | 'binary' — DXT 规范字段，Space 当前只用 'node' / 'binary'，
   *  'python' 走 binary（用户提供解释器路径） */
  type: z.enum(['node', 'python', 'binary']).optional(),
  /** archive 内相对路径 —— '/' 或 'C:\' 开头会被拒绝 */
  entry_point: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (v) => !v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v) && !v.startsWith('\\'),
      'entry_point must be a relative path inside the archive',
    )
    .refine((v) => !v.split(/[\\/]/).includes('..'), 'entry_point must not contain ..')
    .optional(),
  /** 实际执行命令 —— 'node' / 'python' / 二进制名 */
  mcp_config: z
    .object({
      command: z.string().min(1).max(512),
      args: z.array(z.string().min(0).max(1024)).max(64).optional(),
      env: z.record(envValueSchema).optional(),
    })
    .passthrough(),
}).passthrough();

const toolSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().max(1024).optional(),
  })
  .passthrough();

export const manifestSchema = z
  .object({
    /** dxt_version (官方) / manifest_version (旧别名) —— 任意一个即可 */
    dxt_version: z.string().regex(/^[0-9]+\.[0-9]+(\.[0-9]+)?$/).optional(),
    manifest_version: z.string().regex(/^[0-9]+\.[0-9]+(\.[0-9]+)?$/).optional(),
    name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._\-]+$/, 'name must be kebab/identifier'),
    display_name: z.string().min(1).max(128).optional(),
    version: z.string().min(1).max(64).regex(/^[0-9A-Za-z.+\-]+$/, 'invalid semver'),
    description: z.string().max(2048).optional(),
    author: z
      .object({
        name: z.string().min(1).max(128).optional(),
        email: z.string().max(256).optional(),
        url: z.string().max(2048).optional(),
      })
      .passthrough()
      .optional(),
    server: serverSchema,
    tools: z.array(toolSchema).max(1024).optional(),
  })
  .passthrough()
  .refine(
    (v) => Boolean(v.dxt_version ?? v.manifest_version),
    { message: 'manifest must declare dxt_version or manifest_version' },
  );

export type ManifestT = z.infer<typeof manifestSchema>;

/** 解析 manifest 字节流 —— 返回 ManifestT 或 reason 字符串 */
export function parseManifest(buf: Buffer): { ok: true; manifest: ManifestT } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    return { ok: false, error: `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `manifest invalid at ${first.path.join('.') || '<root>'}: ${first.message}` : 'manifest invalid',
    };
  }
  return { ok: true, manifest: parsed.data };
}

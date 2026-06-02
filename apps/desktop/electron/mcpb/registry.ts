// .mcpb extensions registry — F021 (v0.1.3)  + v0.1.3.1 patches
//
// 存哪里：
//   ~/.kodax-space/mcpb-extensions.json
//
// v0.1.3.1 修复：
//   - F021-FUNC-M3: addOrReplace 返回 displaced.installDir，让 caller rm 旧目录
//                   （之前升级时旧 ver 目录永远不删 → 磁盘泄漏）
//   - F021-SEC-M2: readRegistry 用 Zod schema 验证每条 entry，挂 console.warn 丢掉损坏条目
//                   （之前 bare cast → 篡改 registry 可注入 installDir: "../.."）
//   - F021-SEC-L1: 写入用 in-process mutex 串行化（registry 写 fight 概率小但便宜）

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { McpbExtensionT } from '@kodax-space/space-ipc-schema';
import type { ManifestT } from './manifest.js';

const SPACE_HOME = path.join(os.homedir(), '.kodax-space');
const REGISTRY_PATH = path.join(SPACE_HOME, 'mcpb-extensions.json');
const EXTRACT_BASE = path.join(SPACE_HOME, 'mcpb');
const TMP_BASE = path.join(SPACE_HOME, 'tmp');

export interface InternalMcpbEntry extends McpbExtensionT {
  installDir: string;
  server: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface RegistryFile {
  version: 1;
  extensions: InternalMcpbEntry[];
}

const EMPTY: RegistryFile = { version: 1, extensions: [] };

// v0.1.3.1: 读盘后逐条 zod 校验 —— 防 attacker 篡改 mcpb-extensions.json 注 installDir: "../.." 或
// server.command: "bash"（绕 manifest 校验直接写盘）。
const entrySchema = z.object({
  extensionId: z.string().min(1).max(256),
  name: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  version: z.string().min(1).max(64).regex(/^[0-9A-Za-z.+\-]+$/),
  description: z.string().max(280).optional(),
  author: z.string().max(128).optional(),
  transport: z.enum(['stdio', 'http']),
  toolCount: z.number().int().min(0).max(1024),
  installedAt: z.number().int().min(0),
  // 内部字段也校验：installDir 必须是绝对路径，server.command 仍走 allowlist （读盘信不过 manifest 写时已校验）
  installDir: z.string().min(1).max(4096).refine((v) => path.isAbsolute(v), 'installDir must be absolute'),
  server: z
    .object({
      command: z.string().min(1).max(64),
      args: z.array(z.string()).max(64).optional(),
      env: z.record(z.string()).optional(),
    })
    .strict(),
});

export function getExtractBase(): string {
  return EXTRACT_BASE;
}

export function getTmpBase(): string {
  return TMP_BASE;
}

/**
 * 卸载守护用 —— 给定路径，判断它是否在 mcpb extract 根下
 * 用 path.resolve + startsWith(EXTRACT_BASE + sep) 严格做"前缀目录"匹配，
 * 不是 includes() 字符串匹配（后者可被 ~/.kodax-space-evil 绕开）。
 */
export function isInsideExtractBase(p: string): boolean {
  const resolved = path.resolve(p);
  const baseWithSep = EXTRACT_BASE.endsWith(path.sep) ? EXTRACT_BASE : EXTRACT_BASE + path.sep;
  return resolved === EXTRACT_BASE || resolved.startsWith(baseWithSep);
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(SPACE_HOME, { recursive: true });
  await fsp.mkdir(EXTRACT_BASE, { recursive: true });
  await fsp.mkdir(TMP_BASE, { recursive: true });
}

export async function readRegistry(): Promise<RegistryFile> {
  await ensureDir();
  try {
    const buf = await fsp.readFile(REGISTRY_PATH, 'utf8');
    const json = JSON.parse(buf) as unknown;
    if (!json || typeof json !== 'object' || (json as { version?: unknown }).version !== 1) {
      return EMPTY;
    }
    const rawExt = (json as { extensions?: unknown }).extensions;
    if (!Array.isArray(rawExt)) return EMPTY;
    const validated: InternalMcpbEntry[] = [];
    for (const item of rawExt) {
      const parsed = entrySchema.safeParse(item);
      if (!parsed.success) {
        // 篡改 / 旧版 schema 不兼容的条目静默丢弃 —— 不致命，重装即可恢复
        const issue = parsed.error.issues[0];
        const namePart =
          typeof item === 'object' && item !== null && 'name' in item ? String((item as { name: unknown }).name).slice(0, 64) : 'unknown';
        console.warn(
          `[mcpb-registry] dropped invalid entry "${namePart}" at ${issue?.path.join('.') ?? '<root>'}: ${issue?.message ?? 'schema failed'}`,
        );
        continue;
      }
      // 二次校验 installDir 确实在 EXTRACT_BASE 下 —— 否则 caller rm -rf 会越界
      if (!isInsideExtractBase(parsed.data.installDir)) {
        console.warn(
          `[mcpb-registry] dropped entry "${parsed.data.name}": installDir outside extract base`,
        );
        continue;
      }
      validated.push(parsed.data as InternalMcpbEntry);
    }
    return { version: 1, extensions: validated };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY;
    console.warn('[mcpb-registry] read failed, starting empty:', err instanceof Error ? err.message : err);
    return EMPTY;
  }
}

// in-process write mutex —— 串行化 read-modify-write，防同进程两次 install 互相覆盖
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

async function writeRegistry(file: RegistryFile): Promise<void> {
  await ensureDir();
  const tmp = `${REGISTRY_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  // Windows 上跨"原 destination 存在"的 rename 偶尔失败 —— fallback 到 copy+unlink
  try {
    await fsp.rename(tmp, REGISTRY_PATH);
  } catch {
    await fsp.copyFile(tmp, REGISTRY_PATH);
    await fsp.unlink(tmp).catch(() => undefined);
  }
}

export function buildExtensionFromManifest(
  manifest: ManifestT,
  installDir: string,
): InternalMcpbEntry {
  const cfg = manifest.server.mcp_config;
  const env: Record<string, string> = {};
  if (cfg.env) {
    for (const [k, v] of Object.entries(cfg.env)) {
      env[k] = String(v);
    }
  }
  const argsOut: string[] = [];
  if (manifest.server.entry_point) {
    argsOut.push(path.join(installDir, manifest.server.entry_point));
  }
  if (cfg.args) {
    argsOut.push(...cfg.args);
  }
  return {
    extensionId: `${manifest.name}@${manifest.version}`,
    name: manifest.name,
    displayName: manifest.display_name ?? manifest.name,
    version: manifest.version,
    description: manifest.description?.slice(0, 280),
    author: manifest.author?.name?.slice(0, 128),
    transport: 'stdio',
    toolCount: manifest.tools?.length ?? 0,
    installedAt: Date.now(),
    installDir,
    server: {
      command: cfg.command,
      ...(argsOut.length > 0 ? { args: argsOut } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

/**
 * v0.1.3.1: 返回 displacedInstallDir 让 caller rm 旧 install 目录
 *
 * 升级语义：同 name 直接替换。若旧 entry 的 installDir 跟新的 installDir 不一样（升 version
 * 时 slug 变了），调用方需要 rm 旧 installDir。
 */
export async function addOrReplace(
  entry: InternalMcpbEntry,
): Promise<{ registry: RegistryFile; displacedInstallDir?: string }> {
  return withWriteLock(async () => {
    const file = await readRegistry();
    const displaced = file.extensions.find((e) => e.name === entry.name);
    const next: RegistryFile = {
      version: 1,
      extensions: [...file.extensions.filter((e) => e.name !== entry.name), entry],
    };
    await writeRegistry(next);
    return {
      registry: next,
      ...(displaced && displaced.installDir !== entry.installDir
        ? { displacedInstallDir: displaced.installDir }
        : {}),
    };
  });
}

export async function removeByExtensionId(
  extensionId: string,
): Promise<{ removed: boolean; registry: RegistryFile; installDir?: string }> {
  return withWriteLock(async () => {
    const file = await readRegistry();
    const victim = file.extensions.find((e) => e.extensionId === extensionId);
    if (!victim) return { removed: false, registry: file };
    const next: RegistryFile = {
      version: 1,
      extensions: file.extensions.filter((e) => e.extensionId !== extensionId),
    };
    await writeRegistry(next);
    return { removed: true, registry: next, installDir: victim.installDir };
  });
}

export function toExternal(entry: InternalMcpbEntry): McpbExtensionT {
  return {
    extensionId: entry.extensionId,
    name: entry.name,
    displayName: entry.displayName,
    version: entry.version,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.author ? { author: entry.author } : {}),
    transport: entry.transport,
    toolCount: entry.toolCount,
    installedAt: entry.installedAt,
  };
}

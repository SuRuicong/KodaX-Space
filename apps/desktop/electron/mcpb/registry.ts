// .mcpb extensions registry — F021 (v0.1.3)
//
// 存哪里：
//   ~/.kodax-space/mcpb-extensions.json
//
// 形态：
//   {
//     "extensions": [
//       {
//         "extensionId": "filesystem@0.1.0",
//         "name": "filesystem",
//         ... McpbExtensionT ...,
//         "installDir": "<abs>",   // 内部用，不暴露给 renderer
//         "server": { command, args, env, ... }  // 启动配置
//       }
//     ]
//   }
//
// IPC 出参映射时把 installDir / server 剥掉（renderer 只看 McpbExtensionT）。
//
// 并发：单进程 + single-instance lock 保证，所以直接 read-modify-write 即可。
// 原子性：写入用 tmp + rename 模式避免 crash 留半文件。

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpbExtensionT } from '@kodax-space/space-ipc-schema';
import type { ManifestT } from './manifest.js';

const SPACE_HOME = path.join(os.homedir(), '.kodax-space');
const REGISTRY_PATH = path.join(SPACE_HOME, 'mcpb-extensions.json');
const EXTRACT_BASE = path.join(SPACE_HOME, 'mcpb');

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

export function getExtractBase(): string {
  return EXTRACT_BASE;
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(SPACE_HOME, { recursive: true });
  await fsp.mkdir(EXTRACT_BASE, { recursive: true });
}

export async function readRegistry(): Promise<RegistryFile> {
  await ensureDir();
  try {
    const buf = await fsp.readFile(REGISTRY_PATH, 'utf8');
    const json = JSON.parse(buf) as RegistryFile;
    if (!json || json.version !== 1 || !Array.isArray(json.extensions)) {
      return EMPTY;
    }
    return json;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY;
    // 坏 JSON 不让 IPC 失败 —— 用空 + 警告（损坏的旧文件会被下次 install 覆盖）
    console.warn('[mcpb-registry] read failed, starting empty:', err instanceof Error ? err.message : err);
    return EMPTY;
  }
}

async function writeRegistry(file: RegistryFile): Promise<void> {
  await ensureDir();
  const tmp = `${REGISTRY_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await fsp.rename(tmp, REGISTRY_PATH);
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
  // entry_point 是 archive 内相对路径 → 把它前置到 args[0] 让 command 能找到
  // 若 manifest 没指定 entry_point 但指定了 args，就尊重 args
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
    transport: 'stdio', // dxt v0.1 only spec stdio servers
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

/** 升级语义：同 name 直接替换（不留旧 version）—— renderer 看到 version 字段升上去 */
export async function addOrReplace(entry: InternalMcpbEntry): Promise<RegistryFile> {
  const file = await readRegistry();
  const next: RegistryFile = {
    version: 1,
    extensions: [...file.extensions.filter((e) => e.name !== entry.name), entry],
  };
  await writeRegistry(next);
  return next;
}

export async function removeByExtensionId(
  extensionId: string,
): Promise<{ removed: boolean; registry: RegistryFile; installDir?: string }> {
  const file = await readRegistry();
  const victim = file.extensions.find((e) => e.extensionId === extensionId);
  if (!victim) return { removed: false, registry: file };
  const next: RegistryFile = {
    version: 1,
    extensions: file.extensions.filter((e) => e.extensionId !== extensionId),
  };
  await writeRegistry(next);
  return { removed: true, registry: next, installDir: victim.installDir };
}

/** 暴露给 IPC：剥掉 installDir / server 等内部字段 */
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

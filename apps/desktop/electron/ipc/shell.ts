// Shell IPC handlers — reveal a file in the OS file manager / open an external URL.
//
// 见 channels/shell.ts 的安全说明：只暴露 showItemInFolder（永不执行目标）+ openExternal
// （仅 http/https）。没有 shell.openPath（用默认程序打开=对 .exe 等于执行，RCE 面）。

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import { resolveInsideProject } from './files-core.js';
import { projectStore } from '../projects/store.js';
import { getKodaxDir, getSpaceDataDir } from '../kodax/data-paths.js';

const IS_WIN = process.platform === 'win32';

// 惰性拿 electron.shell —— 与 clipboard.ts / artifact.ts 同理：top-level import 'electron'
// 在 tsx/esm 测试 loader（无 electron runtime）下会在 import 期就炸。仅生产 main 调 handler
// 时求值。
function getShell(): typeof import('electron').shell {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = typeof require !== 'undefined' ? null : (import.meta as any);
  const req = meta ? createRequire(meta.url) : require;
  return (req('electron') as typeof import('electron')).shell;
}

/** child 是否落在 parent 子树内（含相等）。Windows 大小写不敏感、统一分隔符。 */
function isWithin(child: string, parent: string): boolean {
  const norm = (s: string): string => {
    const r = path.resolve(s);
    return IS_WIN ? r.toLowerCase() : r;
  };
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/**
 * 一个**绝对**路径是否允许 reveal。reveal 不执行目标，安全面仅"暴露存在性"；但绝对路径分支
 * 无 projectRoot 门禁会让 renderer（compromise / dev-console / LLM 构造的路径）探测任意
 * 系统文件存在性，Windows 上 reveal UNC 路径(\\host\share)还可能触发 SMB/NTLM relay。
 * 故收口为：拒 UNC；且必须落在 (allowlist 项目根 ∪ ~/.kodax ∪ Space 数据目录) 之内。
 * 这覆盖了合法用例：项目内产物、~/.kodax/mcp.json 等配置文件。
 */
async function isAbsoluteRevealAllowed(target: string): Promise<boolean> {
  // 拒 UNC / 网络路径（\\server\share 或 //server/share）。
  if (target.startsWith('\\\\') || target.startsWith('//')) return false;

  const roots = [getKodaxDir(), getSpaceDataDir()];
  try {
    for (const p of await projectStore.list()) roots.push(p.path);
  } catch {
    // 读 allowlist 失败不致命 —— 仍可放行 kodax/space 目录内的配置文件。
  }
  let realTarget: string;
  try {
    realTarget = await fs.realpath(target);
  } catch {
    return false;
  }
  if (realTarget.startsWith('\\\\') || realTarget.startsWith('//')) return false;

  for (const root of roots) {
    try {
      if (isWithin(realTarget, await fs.realpath(root))) return true;
    } catch {
      // Stale project/config directories should not widen the allowlist.
    }
  }
  return false;
}

/**
 * 解析要 reveal 的绝对路径：
 *   - path 绝对 → 通过 isAbsoluteRevealAllowed 门禁后用（项目内产物 / ~/.kodax 配置等）。
 *   - path 相对 + projectRoot → 走 resolveInsideProject（assertAllowed + 防穿越）。
 *   - 相对但无 projectRoot，或绝对但不在白名单内 → 返 null（revealed:false）。
 */
async function resolveRevealTarget(input: {
  path: string;
  projectRoot?: string;
}): Promise<string | null> {
  if (path.isAbsolute(input.path)) {
    return (await isAbsoluteRevealAllowed(input.path)) ? input.path : null;
  }
  if (input.projectRoot === undefined) return null;
  // 相对路径必须落在一个 allowlist 项目内 —— 与 files.read 同款门禁。
  await projectStore.assertAllowed(input.projectRoot);
  return resolveInsideProject(input.projectRoot, input.path);
}

export function registerShellChannels(): void {
  // shell.revealPath —— 在系统文件管理器里定位高亮。reveal 不执行目标。
  registerChannel('shell.revealPath', async (input) => {
    let target: string | null;
    try {
      target = await resolveRevealTarget(input);
    } catch {
      // assertAllowed / 穿越校验失败 → 静默 revealed:false（不向 renderer 抛细节）。
      return { revealed: false };
    }
    if (target === null) return { revealed: false };
    // 存在性兜底：showItemInFolder 对不存在的路径行为不一致（部分平台打开父目录），
    // 先 fs.access 确认存在，否则直接 revealed:false 让 renderer 可提示。
    try {
      await fs.access(target);
    } catch {
      return { revealed: false };
    }
    getShell().showItemInFolder(target);
    return { revealed: true };
  });

  // shell.openExternal —— 系统浏览器打开 http(s)。用原生 URL 解析器判协议（比正则更难被
  // 编码 / IDNA 变体绕过），schema 的 refine 是第一道、这里是第二道。
  registerChannel('shell.openExternal', async (input) => {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return { opened: false };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { opened: false };
    await getShell().openExternal(input.url);
    return { opened: true };
  });
}

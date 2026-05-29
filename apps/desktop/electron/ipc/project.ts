// Project IPC handlers — F005.
//
// 4 个 invoke channel：list / openDialog / recent.add / recent.remove + project.gitStats。
// projectStore 持久化在 ~/.kodax/space/projects.json，main 端独占——renderer 永远不写文件。

import { BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { projectStore } from '../projects/store.js';
import type { ProjectGitStatsDaily } from '@kodax-space/space-ipc-schema';

export function registerProjectChannels(): void {
  // project.list
  registerChannel('project.list', async () => {
    const projects = await projectStore.list();
    return { projects };
  });

  // project.openDialog
  // renderer 调这个 → main 调 OS 原生 picker → 返回用户选的 absolute path。
  // 用 focused window 作为 modal parent，picker 表现一致；fallback 到 frameless 模式（无 parent）。
  registerChannel('project.openDialog', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });

    if (result.canceled || result.filePaths.length === 0) {
      return { path: null };
    }
    return { path: result.filePaths[0] };
  });

  // project.recent.add
  // path 必须先过 validateProjectRoot（abs path / no NUL / no ..）——renderer 传来的
  // path 来源应当是 project.openDialog 的输出，但仍然在 IPC 边界再校验一次（防 renderer 篡改）。
  registerChannel('project.recent.add', async (input) => {
    const path = validateProjectRoot(input.path);
    const project = await projectStore.addOrBump(path);
    return { project };
  });

  // project.recent.remove
  registerChannel('project.recent.remove', async (input) => {
    const path = validateProjectRoot(input.path);
    const removed = await projectStore.remove(path);
    return { removed };
  });

  // project.gitStats
  //
  // 用 child_process spawn git binary 聚合 commit / churn / 每日活跃度。不引入
  // simple-git 依赖（避免 +30MB deps；renderer 不直接调，main 边界做参数校验更严）。
  //
  // 安全：
  //   - projectRoot 走 validateProjectRoot（abs path / no NUL / no ..）
  //   - git args 全部是固定常量 + 数字时间戳 — 没有 shell expansion 风险
  //   - 用 spawn (不是 exec)，arg array 直传，绕过 shell 解析
  //   - 5s 超时；非 git repo / git binary 缺失 / 命令失败 → 返回 isGitRepo:false + 全 0
  //
  // 缓存：mtime-based on .git/HEAD。本进程 module-level Map，5s 也够 dashboard 频繁切 range 用。
  registerChannel('project.gitStats', async (input) => {
    const projectRoot = validateProjectRoot(input.projectRoot);
    const sinceDays = input.sinceDays;

    const cached = readGitStatsCache(projectRoot, sinceDays);
    if (cached) return cached;

    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      const fallback = makeEmptyGitStats();
      writeGitStatsCache(projectRoot, sinceDays, fallback);
      return fallback;
    }

    // git log args — `--since=N.days.ago` 只在 N != null 时加；否则跨整段历史
    const sinceArg = sinceDays !== null ? [`--since=${sinceDays}.days.ago`] : [];

    // 1) commits 数 + per-day histogram (date 短 ISO `%cs`)。
    //    `%H|%cs|%ae` 解析最便宜；按行扫一遍即可。
    const logFmt = await runGit(projectRoot, [
      'log',
      ...sinceArg,
      '--no-merges',
      '--pretty=format:%H|%cs|%ae',
    ]);
    if (!logFmt.ok) {
      const fallback = makeEmptyGitStats();
      fallback.isGitRepo = true; // 上一步证实是 repo，只是 log 失败
      writeGitStatsCache(projectRoot, sinceDays, fallback);
      return fallback;
    }

    const dailyMap = new Map<string, number>();
    const authorSet = new Set<string>();
    let commits = 0;
    for (const line of logFmt.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split('|');
      if (parts.length < 3) continue;
      const [, date, email] = parts;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
      }
      if (email) authorSet.add(email);
      commits++;
    }
    const dailyCommits: ProjectGitStatsDaily[] = Array.from(dailyMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-365);

    // 2) lines + filesChanged — `git log --numstat` 输出 "added\tdeleted\tpath" per file。
    //    binary 文件输出 "-\t-\tpath"，跳过。
    let linesAdded = 0;
    let linesDeleted = 0;
    const filesSet = new Set<string>();
    if (commits > 0) {
      const numstat = await runGit(projectRoot, [
        'log',
        ...sinceArg,
        '--no-merges',
        '--numstat',
        '--pretty=format:',
      ]);
      if (numstat.ok) {
        for (const line of numstat.stdout.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          const parts = trimmed.split('\t');
          if (parts.length < 3) continue;
          const [add, del, file] = parts;
          if (add !== '-') linesAdded += Number.parseInt(add, 10) || 0;
          if (del !== '-') linesDeleted += Number.parseInt(del, 10) || 0;
          if (file && file.length > 0) filesSet.add(file);
        }
      }
    }

    // 3) current branch
    let currentBranch: string | null = null;
    const branchRes = await runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branchRes.ok) {
      const b = branchRes.stdout.trim();
      if (b.length > 0 && b.length <= 256) currentBranch = b;
    }

    const result = {
      isGitRepo: true,
      commits,
      filesChanged: filesSet.size,
      linesAdded,
      linesDeleted,
      contributors: authorSet.size,
      dailyCommits,
      currentBranch,
    };
    writeGitStatsCache(projectRoot, sinceDays, result);
    return result;
  });

  // project.gitStatus — 工作区 dirty 状态轻量查询 (StashNotice 用)
  //
  // `git status --porcelain=v1 -b` 单次输出: 第一行 "## branch [ahead N, behind M]",
  // 后续每行 XY <path>:
  //   X = staged 状态 (M/A/D/R/C),   Y = worktree 状态 (M/D),  '??' = untracked
  // 统计四个 counter,**不**回 path (隐私 + DoS guard)。
  //
  // 缓存: module-level + 5s TTL, 同 gitStats; 用 projectRoot 作 key。
  registerChannel('project.gitStatus', async (input) => {
    const projectRoot = validateProjectRoot(input.projectRoot);
    const cached = readGitStatusCache(projectRoot);
    if (cached) return cached;

    const isRepo = await runGit(projectRoot, ['rev-parse', '--git-dir']);
    if (!isRepo.ok) {
      const fallback = {
        isGitRepo: false,
        dirty: false,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        branch: null,
      } as const;
      writeGitStatusCache(projectRoot, fallback);
      return fallback;
    }

    const status = await runGit(projectRoot, ['status', '--porcelain=v1', '-b']);
    if (!status.ok) {
      const fallback = {
        isGitRepo: true,
        dirty: false,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        branch: null,
      } as const;
      writeGitStatusCache(projectRoot, fallback);
      return fallback;
    }

    // 解析 stdout
    let modifiedCount = 0;
    let stagedCount = 0;
    let untrackedCount = 0;
    let branch: string | null = null;
    let ahead: number | undefined;
    let behind: number | undefined;

    const lines = status.stdout.split('\n');
    for (const rawLine of lines) {
      if (!rawLine) continue;
      if (rawLine.startsWith('## ')) {
        // "## main" / "## main...origin/main" / "## main...origin/main [ahead 2, behind 1]" / "## HEAD (no branch)"
        const body = rawLine.slice(3);
        const dotsIdx = body.indexOf('...');
        const bracketIdx = body.indexOf(' [');
        const branchEnd = dotsIdx >= 0 ? dotsIdx : bracketIdx >= 0 ? bracketIdx : body.length;
        const rawBranch = body.slice(0, branchEnd).trim();
        // 防 IPC schema max 256
        branch = rawBranch.length > 0 ? rawBranch.slice(0, 256) : 'HEAD';
        if (bracketIdx >= 0) {
          const trail = body.slice(bracketIdx + 2, body.endsWith(']') ? -1 : undefined);
          const aheadMatch = /ahead (\d+)/.exec(trail);
          const behindMatch = /behind (\d+)/.exec(trail);
          if (aheadMatch) ahead = Math.min(parseInt(aheadMatch[1], 10), 1_000_000);
          if (behindMatch) behind = Math.min(parseInt(behindMatch[1], 10), 1_000_000);
        }
        continue;
      }
      if (rawLine.startsWith('??')) {
        untrackedCount++;
        continue;
      }
      // XY <path>: char[0] = staged, char[1] = worktree。 空格代表无该侧改动。
      const x = rawLine.charAt(0);
      const y = rawLine.charAt(1);
      if (x !== ' ' && x !== '?') stagedCount++;
      if (y !== ' ' && y !== '?') modifiedCount++;
    }

    const result = {
      isGitRepo: true,
      dirty: modifiedCount + stagedCount + untrackedCount > 0,
      modifiedCount,
      stagedCount,
      untrackedCount,
      branch,
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
    };
    writeGitStatusCache(projectRoot, result);
    return result;
  });
}

// gitStatus cache (类比 gitStats 但 key 更简单 — 不带 sinceDays)
type GitStatusOutput = {
  isGitRepo: boolean;
  dirty: boolean;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  branch: string | null;
  ahead?: number;
  behind?: number;
};
const GIT_STATUS_TTL_MS = 5_000;
const gitStatusCache = new Map<string, { ts: number; data: GitStatusOutput }>();
function readGitStatusCache(projectRoot: string): GitStatusOutput | null {
  const entry = gitStatusCache.get(projectRoot);
  if (!entry) return null;
  if (Date.now() - entry.ts > GIT_STATUS_TTL_MS) {
    gitStatusCache.delete(projectRoot);
    return null;
  }
  return entry.data;
}
function writeGitStatusCache(projectRoot: string, data: GitStatusOutput): void {
  gitStatusCache.set(projectRoot, { ts: Date.now(), data });
  // module 级缓存,避免无限增长
  if (gitStatusCache.size > 32) {
    const firstKey = gitStatusCache.keys().next().value;
    if (firstKey !== undefined) gitStatusCache.delete(firstKey);
  }
}

// ---- git child_process helper ----

interface GitRunResult {
  ok: boolean;
  stdout: string;
}

/**
 * spawn git with safety knobs：
 *   - shell:false 关掉 shell injection 表面
 *   - 5s 超时——dashboard 是 UI 路径，不该被恶意 / 巨型 repo 卡住
 *   - 1MB stdout 上限（histogram 365 行 / numstat 大 repo 也够）；超过截断不抛
 */
async function runGit(cwd: string, args: readonly string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let truncated = false;
    const MAX_BYTES = 1_048_576;
    let timer: NodeJS.Timeout | null = null;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    } catch {
      resolve({ ok: false, stdout: '' });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, stdout });
    }, 5_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const text = chunk.toString('utf8');
      if (stdout.length + text.length > MAX_BYTES) {
        stdout += text.slice(0, MAX_BYTES - stdout.length);
        truncated = true;
      } else {
        stdout += text;
      }
    });

    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, stdout });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, stdout });
    });
  });
}

function makeEmptyGitStats(): {
  isGitRepo: boolean;
  commits: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  contributors: number;
  dailyCommits: ProjectGitStatsDaily[];
  currentBranch: string | null;
} {
  return {
    isGitRepo: false,
    commits: 0,
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    contributors: 0,
    dailyCommits: [],
    currentBranch: null,
  };
}

// ---- module-level mtime cache ----
//
// dashboard 频繁切 range tab（All / 30d / 7d）会重复打这个 channel；5s TTL 让连点不
// 真跑 git。key=`${projectRoot}|${sinceDays}` —— 同 root 不同 range 独立缓存。

interface CacheEntry {
  ts: number;
  value: Awaited<ReturnType<typeof makeEmptyGitStats>>;
}
const gitStatsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000;

function cacheKey(projectRoot: string, sinceDays: number | null): string {
  return `${projectRoot}|${sinceDays ?? 'all'}`;
}

function readGitStatsCache(
  projectRoot: string,
  sinceDays: number | null,
): CacheEntry['value'] | null {
  const entry = gitStatsCache.get(cacheKey(projectRoot, sinceDays));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    gitStatsCache.delete(cacheKey(projectRoot, sinceDays));
    return null;
  }
  return entry.value;
}

function writeGitStatsCache(
  projectRoot: string,
  sinceDays: number | null,
  value: CacheEntry['value'],
): void {
  // 简单 LRU-ish：超 32 条干脆全清，dashboard 用量小不值得做精细 LRU
  if (gitStatsCache.size > 32) gitStatsCache.clear();
  gitStatsCache.set(cacheKey(projectRoot, sinceDays), { ts: Date.now(), value });
}

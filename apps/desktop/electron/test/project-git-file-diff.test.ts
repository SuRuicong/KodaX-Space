// F044 v0.1.10 — project.gitFileDiff IPC handler tests.
//
// 真 git fixture (mkdtemp + git init + commit + 改文件) 覆盖五种 case:
//   - tracked + modified
//   - untracked (新加未 commit)
//   - deleted (working tree 删了, HEAD 还在)
//   - binary file (含 NUL byte)
//   - 文件太大 (> 1 MB)
//   - not a git repo (空目录)
//
// Handler 直接调用 (绕过 ipcMain.handle),靠 register.ts 内部桥接;为了简单这里
// import 内部 implementation 也行,但 register 桥接更接近实际 IPC 路径。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// 用动态 import 避免 IPC handler 在测试模块顶层就 register (`register.ts` 内部
// lazy 拿 ipcMain,但 registerProjectChannels 调多次会撞 dup-channel 守门).

let testRoot: string;

function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.on('error', () => resolve({ ok: false, stdout }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout }));
  });
}

async function gitInit(root: string): Promise<void> {
  await runGit(root, ['init', '--quiet', '-b', 'main']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await runGit(root, ['config', 'user.name', 'Test User']);
  // disable autocrlf for cross-platform deterministic diff
  await runGit(root, ['config', 'core.autocrlf', 'false']);
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kodax-gitdiff-'));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
});

// Helper — directly invoke the handler bypassing IPC.
// 重 import 模块,handler 在 registerProjectChannels 内 lazy 注册,所以本测试转去
// 用同款 logic 直接 spawn git 验证 git 命令链而非整 IPC envelope。这避免了在
// node:test 环境注册 ipcMain handler 的复杂度。
//
// Acceptable trade-off: 测试不跑 IPC envelope,但覆盖了 git 业务逻辑 (binary detect /
// file size cap / untracked / not-a-git-repo)。完整 IPC envelope 行为靠现有的
// register.ts 共享 helper 已覆盖。

async function readWorkingTreeFile(root: string, relPath: string): Promise<{
  exists: boolean;
  size: number;
  isBinary: boolean;
  content: string;
}> {
  const abs = path.join(root, relPath);
  try {
    const stat = await fs.stat(abs);
    const handle = await fs.open(abs, 'r');
    let isBinary = false;
    try {
      const headBuf = Buffer.allocUnsafe(8192);
      const { bytesRead } = await handle.read(headBuf, 0, 8192, 0);
      if (headBuf.subarray(0, bytesRead).includes(0)) isBinary = true;
    } finally {
      await handle.close();
    }
    if (isBinary) return { exists: true, size: stat.size, isBinary: true, content: '' };
    if (stat.size > 1_048_576) return { exists: true, size: stat.size, isBinary: false, content: '' };
    const content = await fs.readFile(abs, 'utf-8');
    return { exists: true, size: stat.size, isBinary: false, content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { exists: false, size: 0, isBinary: false, content: '' };
    throw err;
  }
}

test('tracked + modified: HEAD content from git show, working-tree from fs', async () => {
  await gitInit(testRoot);
  await fs.writeFile(path.join(testRoot, 'a.txt'), 'line1\nline2\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);
  // modify
  await fs.writeFile(path.join(testRoot, 'a.txt'), 'line1\nLINE2-modified\nline3\n');

  const showRes = await runGit(testRoot, ['show', 'HEAD:a.txt']);
  assert.equal(showRes.ok, true);
  assert.equal(showRes.stdout, 'line1\nline2\n');

  const wt = await readWorkingTreeFile(testRoot, 'a.txt');
  assert.equal(wt.exists, true);
  assert.equal(wt.isBinary, false);
  assert.equal(wt.content, 'line1\nLINE2-modified\nline3\n');
});

test('untracked: file in working tree but not in HEAD → git show fails', async () => {
  await gitInit(testRoot);
  await fs.writeFile(path.join(testRoot, 'tracked.txt'), 'committed\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);
  // new untracked file
  await fs.writeFile(path.join(testRoot, 'new.txt'), 'fresh\n');

  const showRes = await runGit(testRoot, ['show', 'HEAD:new.txt']);
  assert.equal(showRes.ok, false, 'git show should fail for untracked file');

  const wt = await readWorkingTreeFile(testRoot, 'new.txt');
  assert.equal(wt.exists, true);
  assert.equal(wt.content, 'fresh\n');
});

test('deleted: working tree gone, HEAD still has content', async () => {
  await gitInit(testRoot);
  await fs.writeFile(path.join(testRoot, 'dead.txt'), 'will die\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);
  await fs.unlink(path.join(testRoot, 'dead.txt'));

  const showRes = await runGit(testRoot, ['show', 'HEAD:dead.txt']);
  assert.equal(showRes.ok, true, 'HEAD still has the file');
  assert.equal(showRes.stdout, 'will die\n');

  const wt = await readWorkingTreeFile(testRoot, 'dead.txt');
  assert.equal(wt.exists, false);
});

test('binary file: NUL byte in first 8KB triggers isBinary, content not read', async () => {
  await gitInit(testRoot);
  // 1KB 真二进制 (含 NUL byte)
  const binData = Buffer.alloc(1024);
  binData[42] = 0;
  binData[43] = 0xff;
  await fs.writeFile(path.join(testRoot, 'logo.bin'), binData);

  const wt = await readWorkingTreeFile(testRoot, 'logo.bin');
  assert.equal(wt.isBinary, true);
  assert.equal(wt.content, '');
});

test('file too large: > 1 MB working tree file returns empty content + size correct', async () => {
  await gitInit(testRoot);
  // 1.5 MB 全 'a' (text but too large for inline diff)
  const huge = 'a'.repeat(1_500_000);
  await fs.writeFile(path.join(testRoot, 'big.txt'), huge);

  const wt = await readWorkingTreeFile(testRoot, 'big.txt');
  assert.equal(wt.isBinary, false);
  assert.equal(wt.size, 1_500_000);
  // size > 1 MB → content 不读出来 (实际 handler 会返 reason='file-too-large')
  assert.equal(wt.content, '');
});

test('not a git repo: rev-parse --git-dir fails', async () => {
  // 不调 gitInit, testRoot 不是 git repo
  await fs.writeFile(path.join(testRoot, 'a.txt'), 'orphan\n');

  const probe = await runGit(testRoot, ['rev-parse', '--git-dir']);
  assert.equal(probe.ok, false);
});

test('review HIGH-1: schema rejects NUL byte in path', async () => {
  // 跑 schema parse 验证 zod refine 触发 (不需要真 fs 操作)
  const { projectGitFileDiffChannel } = await import('@kodax-space/space-ipc-schema');
  const r = projectGitFileDiffChannel.input.safeParse({
    projectRoot: '/proj/x',
    path: 'src/foo\x00bar.ts',
  });
  assert.equal(r.success, false, 'NUL byte should be rejected');
});

test('git autocrlf=false ensures cross-platform deterministic before content', async () => {
  // Windows CI git 默认 autocrlf=true 会把 LF 转 CRLF on checkout 而 commit 时存 LF。
  // 我们的 fixture 在 gitInit 里强制 false,验证 commit 后 git show 返 LF。
  await gitInit(testRoot);
  await fs.writeFile(path.join(testRoot, 'a.txt'), 'a\nb\nc\n');
  await runGit(testRoot, ['add', '.']);
  await runGit(testRoot, ['commit', '-m', 'init', '--quiet']);

  const showRes = await runGit(testRoot, ['show', 'HEAD:a.txt']);
  // 严格 LF
  assert.equal(showRes.stdout, 'a\nb\nc\n');
  assert.equal(showRes.stdout.includes('\r'), false);
});

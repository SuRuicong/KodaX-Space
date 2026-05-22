// agents-md-loader wrapper tests — v0.1.6 cleanup (切到 SDK loadAgentsFiles)
//
// 实际 AGENTS.md 加载/截断/递归扫等行为由 SDK loadAgentsFiles 负责，本文件仅测
// Space wrapper 层的契约：
//   1. projectRoot 非 absolute → [] + warning (Space defense-in-depth)
//   2. SDK 调用成功返回 → wrapper 透传
//
// 不再测 SDK 内部行为（truncation/byte size/dir check/dedup）—— 那些归 SDK 测。

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAgentsMd } from '../kodax/agents-md-loader.js';

let tmpRoot: string;
let projectRoot: string;
let kodaxGlobalDir: string;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'space-agents-md-test-'));
  projectRoot = path.join(tmpRoot, 'project');
  kodaxGlobalDir = path.join(tmpRoot, '.kodax');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(kodaxGlobalDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 清理 fixture 文件让每个 case 起点干净
  for (const p of [
    path.join(projectRoot, 'AGENTS.md'),
    path.join(kodaxGlobalDir, 'AGENTS.md'),
  ]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
});

test('non-absolute projectRoot is rejected with warning, returns []', async () => {
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), 'will not be read');
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const result = await loadAgentsMd({ projectRoot: 'relative/path', kodaxGlobalDir });
    assert.deepEqual(result, []);
    assert.ok(warnings.some((w) => w.includes('must be absolute')), 'should warn about non-absolute');
  } finally {
    console.warn = originalWarn;
  }
});

test('empty projectRoot has no project-scope AGENTS.md', async () => {
  // 注：SDK 用 cwd=projectRoot 递归扫到 root；tmp 路径上没有 AGENTS.md，但 kodaxGlobalDir 可能有
  // (此 fixture beforeEach 清掉了)。断言 project 范围空——global 范围如果 ~/.kodax 有真文件可能命中。
  const result = await loadAgentsMd({ projectRoot, kodaxGlobalDir });
  const projectFiles = result.filter((f) => f.scope === 'project');
  assert.equal(projectFiles.length, 0);
});

test('project AGENTS.md is picked up by SDK', async () => {
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project rules');
  const result = await loadAgentsMd({ projectRoot, kodaxGlobalDir });
  // SDK 可能标 scope='directory'（递归扫到 projectRoot）或 'project'
  const projectFile = result.find((f) => f.content === '# Project rules');
  assert.ok(projectFile, 'project AGENTS.md must be returned');
  assert.ok(
    projectFile.scope === 'project' || projectFile.scope === 'directory',
    `expected scope project|directory, got ${projectFile.scope}`,
  );
});

test('returns absolute paths in path field', async () => {
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# P');
  const result = await loadAgentsMd({ projectRoot, kodaxGlobalDir });
  for (const f of result) {
    assert.ok(path.isAbsolute(f.path), `path must be absolute: ${f.path}`);
  }
});

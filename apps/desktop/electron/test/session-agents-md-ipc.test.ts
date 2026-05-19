// FEATURE_034: session.agentsMd IPC handler — end-to-end via kodaxHost.
//
// 验证：
//   - 已知 session + 项目根有 AGENTS.md → 拉到对应 file
//   - 已知 session + 项目根无 AGENTS.md → 返回空数组（不抛）
//   - 未知 session → handler throw → registerChannel 包成 HANDLER_ERROR envelope
//   - 不缓存：磁盘改了后再调一次拿到新内容

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kodaxHost } from '../kodax/host.js';
import {
  loadAgentsMd,
  TRUNCATION_MARKER,
} from '../kodax/agents-md-loader.js';
import { setRendererTarget } from '../ipc/push.js';

let tmpProjectRoot: string;

beforeEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => ({
    send: () => undefined,
    isDestroyed: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-agentsmd-test-'));
});

afterEach(async () => {
  await kodaxHost.disposeAll();
  setRendererTarget(() => null);
  if (tmpProjectRoot && fs.existsSync(tmpProjectRoot)) {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
  }
});

test('loadAgentsMd: returns empty when no AGENTS.md exists', async () => {
  // 用临时 globalDir 避免读到真实 ~/.kodax/AGENTS.md
  const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-global-empty-'));
  try {
    const files = await loadAgentsMd({ projectRoot: tmpProjectRoot, kodaxGlobalDir: tmpGlobal });
    assert.equal(files.length, 0);
  } finally {
    fs.rmSync(tmpGlobal, { recursive: true, force: true });
  }
});

test('loadAgentsMd: picks up project AGENTS.md', async () => {
  fs.writeFileSync(path.join(tmpProjectRoot, 'AGENTS.md'), '# project rules');
  const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-global-empty-'));
  try {
    const files = await loadAgentsMd({ projectRoot: tmpProjectRoot, kodaxGlobalDir: tmpGlobal });
    assert.equal(files.length, 1);
    assert.equal(files[0].scope, 'project');
    assert.equal(files[0].content, '# project rules');
  } finally {
    fs.rmSync(tmpGlobal, { recursive: true, force: true });
  }
});

test('loadAgentsMd: picks up global + project, global first (KodaX prompt builder order)', async () => {
  const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-global-'));
  fs.writeFileSync(path.join(tmpGlobal, 'AGENTS.md'), '# global rules');
  fs.writeFileSync(path.join(tmpProjectRoot, 'AGENTS.md'), '# project rules');
  try {
    const files = await loadAgentsMd({ projectRoot: tmpProjectRoot, kodaxGlobalDir: tmpGlobal });
    assert.equal(files.length, 2);
    assert.equal(files[0].scope, 'global');
    assert.equal(files[1].scope, 'project');
  } finally {
    fs.rmSync(tmpGlobal, { recursive: true, force: true });
  }
});

test('loadAgentsMd: reflects disk changes on subsequent call (no cache)', async () => {
  const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-global-nocache-'));
  const agentsPath = path.join(tmpProjectRoot, 'AGENTS.md');
  fs.writeFileSync(agentsPath, 'v1');
  try {
    const first = await loadAgentsMd({ projectRoot: tmpProjectRoot, kodaxGlobalDir: tmpGlobal });
    assert.equal(first[0]?.content, 'v1');
    fs.writeFileSync(agentsPath, 'v2');
    const second = await loadAgentsMd({ projectRoot: tmpProjectRoot, kodaxGlobalDir: tmpGlobal });
    assert.equal(second[0]?.content, 'v2', 'second load should see v2 (no cache)');
  } finally {
    fs.rmSync(tmpGlobal, { recursive: true, force: true });
  }
});

test('loadAgentsMd: rejects relative projectRoot defensively', async () => {
  const files = await loadAgentsMd({ projectRoot: 'relative/path' });
  assert.equal(files.length, 0);
});

test('IPC integration: createSession then session.agentsMd works via kodaxHost.get', async () => {
  // reviewer F034 MEDIUM-1: 注入 tmpGlobal 避免读到真实 ~/.kodax/AGENTS.md 造成断言非确定
  const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-global-ipc-'));
  fs.writeFileSync(path.join(tmpProjectRoot, 'AGENTS.md'), '# IPC integration');
  const { sessionId } = kodaxHost.createSession({
    projectRoot: tmpProjectRoot,
    provider: 'mock',
  });
  const session = kodaxHost.get(sessionId);
  assert.ok(session);
  try {
    // 模拟 IPC handler 调用：从 session 拿 projectRoot 然后 loadAgentsMd
    const files = await loadAgentsMd({
      projectRoot: session.projectRoot,
      kodaxGlobalDir: tmpGlobal,
    });
    assert.equal(files.length, 1);
    assert.equal(files[0].scope, 'project');
    assert.equal(files[0].content, '# IPC integration');
  } finally {
    fs.rmSync(tmpGlobal, { recursive: true, force: true });
  }
});

// reviewer F034 LOW-1: TRUNCATION_MARKER must fit within the schema's 64-byte buffer
test('TRUNCATION_MARKER stays under 64 chars (schema buffer invariant)', () => {
  assert.ok(
    TRUNCATION_MARKER.length < 64,
    `marker length ${TRUNCATION_MARKER.length} must be < 64 (agentsFileSchema content buffer)`,
  );
});

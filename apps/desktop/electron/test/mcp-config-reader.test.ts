// MCP config-reader tests — FEATURE_036 alpha.1.
//
// 真跑文件 IO：tmp 项目根 + tmp global dir，验证 read / parse / project-overrides-global /
// 错误路径（损坏 JSON / shape 不对的 server / 文件不存在）。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverMcpServers } from '../mcp/config-reader.js';

let tmpProjectRoot: string;
let tmpGlobalDir: string;

beforeEach(() => {
  tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-mcp-proj-'));
  tmpGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-mcp-global-'));
});

afterEach(() => {
  for (const dir of [tmpProjectRoot, tmpGlobalDir]) {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeGlobalConfig(content: object | string): void {
  fs.writeFileSync(
    path.join(tmpGlobalDir, 'config.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

function writeProjectConfig(content: object | string): void {
  const dir = path.join(tmpProjectRoot, '.kodax');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

test('no config files → empty servers + empty errors', async () => {
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.deepEqual(r.servers, []);
  assert.deepEqual(r.errors, []);
});

test('global stdio server is discovered', async () => {
  writeGlobalConfig({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'filesystem');
  assert.equal(r.servers[0].transport, 'stdio');
  assert.equal(r.servers[0].command, 'npx');
  assert.deepEqual(r.servers[0].args, ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.equal(r.servers[0].source, 'global');
  assert.equal(r.servers[0].envCount, 0);
});

test('http server (url) is discovered', async () => {
  writeGlobalConfig({
    mcpServers: {
      'remote-tools': { url: 'https://example.com/mcp' },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].transport, 'http');
  assert.equal(r.servers[0].url, 'https://example.com/mcp');
});

test('env count is reported, env values are NOT exposed', async () => {
  writeGlobalConfig({
    mcpServers: {
      'with-env': {
        command: 'python',
        env: { SECRET_KEY: 'shh', API_TOKEN: 'also-secret', LOG_LEVEL: 'debug' },
      },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers[0].envCount, 3);
  // 验证 server meta 不含原始 env 值
  const serialized = JSON.stringify(r.servers[0]);
  assert.equal(serialized.includes('SECRET_KEY'), false);
  assert.equal(serialized.includes('shh'), false);
});

test('project-level config overrides global (same name)', async () => {
  writeGlobalConfig({
    mcpServers: {
      shared: { command: 'global-version' },
    },
  });
  writeProjectConfig({
    mcpServers: {
      shared: { command: 'project-version' },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 1, 'duplicate name → single entry (project wins)');
  assert.equal(r.servers[0].command, 'project-version');
  assert.equal(r.servers[0].source, 'project');
});

test('project + global non-overlapping → both appear', async () => {
  writeGlobalConfig({ mcpServers: { g: { command: 'gcmd' } } });
  writeProjectConfig({ mcpServers: { p: { command: 'pcmd' } } });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 2);
  const names = r.servers.map((s) => s.name).sort();
  assert.deepEqual(names, ['g', 'p']);
});

test('invalid JSON in global → errors with path; other config still parses', async () => {
  fs.writeFileSync(path.join(tmpGlobalDir, 'config.json'), '{ this is not json');
  writeProjectConfig({ mcpServers: { p: { command: 'pcmd' } } });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 1, 'project still parses');
  assert.equal(r.servers[0].name, 'p');
  assert.ok(
    r.errors.some((e) => e.error.includes('invalid JSON')),
    'broken global JSON should appear in errors',
  );
});

test('server entry without command or url → skipped + error', async () => {
  writeGlobalConfig({
    mcpServers: {
      'good': { command: 'ok' },
      'bad': { /* no command, no url */ },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'good');
  assert.ok(
    r.errors.some((e) => e.path.includes('#bad')),
    'malformed server should appear in errors with #key suffix',
  );
});

test('mcpServers field missing → no error, empty servers', async () => {
  writeGlobalConfig({ someOtherField: true });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.deepEqual(r.servers, []);
  assert.deepEqual(r.errors, []);
});

test('relative projectRoot is rejected', async () => {
  const r = await discoverMcpServers({
    projectRoot: 'not/absolute',
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.deepEqual(r.servers, []);
  assert.equal(r.errors.length, 1);
  assert.ok(r.errors[0].error.includes('absolute'));
});

test('control chars in server name are stripped in error path; long names truncated', async () => {
  const evilName = '\x1b[31mred\x07\x00long'.padEnd(200, 'x'); // ANSI + bell + null + long
  writeGlobalConfig({
    mcpServers: {
      [evilName]: { /* missing command/url → error path will include sanitized name */ },
    },
  });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.equal(r.servers.length, 0);
  assert.equal(r.errors.length, 1);
  // 控制字符被 '?' 替换
  assert.equal(r.errors[0].path.includes('\x1b'), false);
  assert.equal(r.errors[0].path.includes('\x00'), false);
  assert.equal(r.errors[0].path.includes('\x07'), false);
  // 总长度合理 (filePath + '#' + 64 char + '…')，远短于原始 name
  assert.ok(r.errors[0].path.length < 300, `path should be truncated, got ${r.errors[0].path.length}`);
});

test('mcpServers field is not an object → error, no crash', async () => {
  writeGlobalConfig({ mcpServers: ['not', 'an', 'object'] });
  const r = await discoverMcpServers({
    projectRoot: tmpProjectRoot,
    kodaxGlobalDir: tmpGlobalDir,
  });
  assert.deepEqual(r.servers, []);
  assert.ok(r.errors.some((e) => e.error.includes('object')));
});

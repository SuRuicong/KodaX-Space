// Unit tests for IPC boundary validators (no electron runtime needed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateProjectRoot } from '../ipc/validate.js';

test('validateProjectRoot: accepts an absolute POSIX path', () => {
  // path.normalize 在 Windows 上会把 / 转 \；接受 path.normalize 的输出做比较
  const out = validateProjectRoot('/Users/foo/proj');
  assert.equal(out, path.normalize('/Users/foo/proj'));
});

test('validateProjectRoot: accepts an absolute Windows path', () => {
  // path.isAbsolute 在非 Windows 上对 C:\... 返回 false——跳过这个 case
  if (process.platform !== 'win32') return;
  const out = validateProjectRoot('C:\\Users\\foo\\proj');
  assert.equal(out, path.normalize('C:\\Users\\foo\\proj'));
});

test('validateProjectRoot: rejects relative path', () => {
  assert.throws(() => validateProjectRoot('./relative/path'), /absolute/);
  assert.throws(() => validateProjectRoot('relative/path'), /absolute/);
  assert.throws(() => validateProjectRoot('../escape'), /absolute|\.\./);
});

test('validateProjectRoot: .. check is defense-in-depth (absolute paths absorb .. via normalize)', () => {
  // 这是个微妙的 invariant：path.normalize 对绝对路径会让 `/foo/../../../etc` → `/etc`，
  // 即 .. 不会留在 normalized 输出里——所以 validator 里的 .. 检查实际是兜底，
  // 防 Node path.normalize 未来出 bug；这里测正常 case 通过即可。
  if (process.platform === 'win32') {
    const out = validateProjectRoot('C:\\foo\\..\\bar');
    assert.equal(out, path.normalize('C:\\foo\\..\\bar'));
  } else {
    const out = validateProjectRoot('/foo/../bar');
    assert.equal(out, path.normalize('/foo/../bar'));
  }
});

test('validateProjectRoot: rejects NUL byte', () => {
  assert.throws(() => validateProjectRoot('/foo\x00/bar'), /NUL/);
});

test('validateProjectRoot: error message truncates very long input (no full echo)', () => {
  try {
    // 故意制造长 relative path 让它走"非绝对路径"拒绝分支
    validateProjectRoot('relative-' + 'a'.repeat(200));
    assert.fail('should have thrown');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.ok(msg.length < 200, `error message should be truncated, got ${msg.length} chars`);
    assert.ok(msg.includes('...'), 'truncated error message should contain "..."');
  }
});

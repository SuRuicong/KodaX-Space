// F066 — detectArtifactKind: 把 workflow artifact 值收敛成 Space artifact kind + content。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectArtifactKind } from '../artifact/workflow-artifact-bridge.js';

test('string html / svg 嗅探', () => {
  assert.equal(detectArtifactKind('<!DOCTYPE html><html><body>hi</body></html>').kind, 'html');
  assert.equal(detectArtifactKind('<html>x</html>').kind, 'html');
  assert.equal(detectArtifactKind('<svg viewBox="0 0 1 1"></svg>').kind, 'svg');
});

test('string markdown 嗅探（标题/列表/围栏）', () => {
  assert.equal(detectArtifactKind('# Title\n\nbody').kind, 'markdown');
  assert.equal(detectArtifactKind('- item one\n- item two').kind, 'markdown');
  assert.equal(detectArtifactKind('```js\ncode\n```').kind, 'markdown');
});

test('普通字符串 → code', () => {
  assert.equal(detectArtifactKind('just some plain text output').kind, 'code');
});

test('对象 / 数组 → JSON 文本 code', () => {
  const r = detectArtifactKind({ findings: [1, 2], ok: true });
  assert.equal(r.kind, 'code');
  assert.ok(r.content.includes('"findings"'));
  assert.equal(detectArtifactKind([1, 2, 3]).kind, 'code');
});

test('null/undefined → 空 markdown（保留条目不丢）', () => {
  assert.deepEqual(detectArtifactKind(null), { kind: 'markdown', content: '' });
  assert.deepEqual(detectArtifactKind(undefined), { kind: 'markdown', content: '' });
});

test('超大内容按 UTF-8 字节截断（≤ store 1MB 字节上限，多字节也不超）', () => {
  // ASCII：字符数=字节数
  const ascii = detectArtifactKind('x'.repeat(2_000_000));
  assert.ok(Buffer.byteLength(ascii.content, 'utf8') <= 1_048_576);
  // CJK（每字符 3 字节）：按字符截会超字节上限被 store 拒；按字节截则不超
  const cjk = detectArtifactKind('好'.repeat(1_000_000)); // 3MB UTF-8
  assert.ok(Buffer.byteLength(cjk.content, 'utf8') <= 1_048_576, 'CJK 内容字节数必须 ≤ store 上限');
});

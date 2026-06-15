// F059b — artifact export pure helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extForKind,
  sanitizeFilename,
  parseDataUri,
  extForImageDataUri,
} from '../artifact/export-helpers.js';

test('extForKind maps content kinds', () => {
  assert.equal(extForKind('markdown'), 'md');
  assert.equal(extForKind('code'), 'txt');
  assert.equal(extForKind('html'), 'html');
  assert.equal(extForKind('svg'), 'svg');
  assert.equal(extForKind('chart'), 'json');
});

test('sanitizeFilename strips path/reserved/control chars + trailing dots, caps length', () => {
  assert.equal(sanitizeFilename('My Report'), 'My Report');
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j%k'), 'abcdefghijk');
  assert.equal(sanitizeFilename('trailing...'), 'trailing');
  assert.equal(sanitizeFilename(`ctl${String.fromCharCode(0)}x`), 'ctlx');
  assert.equal(sanitizeFilename('x'.repeat(200)).length, 120);
  assert.equal(sanitizeFilename('   '), ''); // becomes empty → caller defaults to 'artifact'
});

test('parseDataUri: base64 + utf8 + invalid', () => {
  const b64 = parseDataUri('data:image/png;base64,aGVsbG8='); // "hello"
  assert.equal(b64?.mime, 'image/png');
  assert.equal(b64?.data.toString('utf8'), 'hello');

  const utf8 = parseDataUri('data:image/svg+xml;utf8,' + encodeURIComponent('<svg/>'));
  assert.equal(utf8?.mime, 'image/svg+xml');
  assert.equal(utf8?.data.toString('utf8'), '<svg/>');

  assert.equal(parseDataUri('not-a-data-uri'), null);
});

test('extForImageDataUri by MIME', () => {
  assert.equal(extForImageDataUri('data:image/png;base64,AAAA'), 'png');
  assert.equal(extForImageDataUri('data:image/jpeg;base64,AAAA'), 'jpg');
  assert.equal(extForImageDataUri('data:image/svg+xml;utf8,<svg/>'), 'svg');
  assert.equal(extForImageDataUri('data:image/webp;base64,AAAA'), 'webp');
  assert.equal(extForImageDataUri('data:application/octet-stream,x'), 'png'); // default
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactPathForDisplay,
  fileUrlToPath,
  parseFileReferences,
} from '../../renderer/src/lib/fileReferences.js';

test('fileUrlToPath decodes darwin file URLs', () => {
  const path = fileUrlToPath(
    'file:///Volumes/TING/Work/1.%20%E6%B5%8B%E8%AF%95/3.2%20call.m4a',
    'darwin',
  );
  assert.equal(path, '/Volumes/TING/Work/1. \u6d4b\u8bd5/3.2 call.m4a');
});

test('fileUrlToPath decodes Windows drive file URLs', () => {
  const path = fileUrlToPath('file:///C:/Users/iceto/Desktop/demo%20file.txt', 'win32');
  assert.equal(path, 'C:\\Users\\iceto\\Desktop\\demo file.txt');
});

test('parseFileReferences turns markdown file links into compact file parts', () => {
  const content =
    'please inspect [demo file.txt]\n(<file:///C:/Users/iceto/Desktop/demo%20file.txt>) today';
  const parts = parseFileReferences(content, 'win32');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { kind: 'text', text: 'please inspect ' });
  assert.equal(parts[1]?.kind, 'file');
  if (parts[1]?.kind === 'file') {
    assert.equal(parts[1].label, 'demo file.txt');
    assert.equal(parts[1].path, 'C:\\Users\\iceto\\Desktop\\demo file.txt');
    assert.match(parts[1].detail, /demo file\.txt$/);
  }
  assert.deepEqual(parts[2], { kind: 'text', text: ' today' });
});

test('compactPathForDisplay keeps the filename visible', () => {
  const compact = compactPathForDisplay(
    '/Volumes/TING/Work/1. very long folder name/51. another long folder/3.2 call.m4a',
    42,
  );
  assert.match(compact, /3\.2 call\.m4a$/);
  assert.ok(compact.length <= 42);
});

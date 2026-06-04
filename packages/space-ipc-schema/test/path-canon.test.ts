import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonProjectRoot } from '../src/path-canon.js';

test('canonProjectRoot — Windows lowercases drive letter + folds separators', () => {
  assert.equal(canonProjectRoot('C:\\Works\\Project', true), 'c:\\works\\project');
  assert.equal(canonProjectRoot('C:/Works/Project', true), 'c:\\works\\project');
  assert.equal(canonProjectRoot('c:\\works\\project', true), 'c:\\works\\project');
});

test('canonProjectRoot — Windows strips trailing separators', () => {
  assert.equal(canonProjectRoot('C:\\Works\\Project\\', true), 'c:\\works\\project');
  assert.equal(canonProjectRoot('C:\\Works\\Project///', true), 'c:\\works\\project');
});

test('canonProjectRoot — Windows preserves root form', () => {
  assert.equal(canonProjectRoot('C:\\', true), 'c:\\');
  assert.equal(canonProjectRoot('C:/', true), 'c:\\');
});

test('canonProjectRoot — Windows UNC paths keep leading backslashes', () => {
  assert.equal(
    canonProjectRoot('\\\\server\\share\\foo', true),
    '\\\\server\\share\\foo',
  );
});

test('canonProjectRoot — POSIX preserves case + slash form', () => {
  assert.equal(canonProjectRoot('/Users/Foo/proj', false), '/Users/Foo/proj');
  assert.equal(canonProjectRoot('/Users/Foo/proj/', false), '/Users/Foo/proj');
});

test('canonProjectRoot — POSIX strips trailing slashes but keeps root', () => {
  assert.equal(canonProjectRoot('/foo/bar//', false), '/foo/bar');
  assert.equal(canonProjectRoot('/', false), '/');
});

test('canonProjectRoot — empty / non-string returns empty', () => {
  assert.equal(canonProjectRoot('', true), '');
  // @ts-expect-error: deliberately checking runtime defense
  assert.equal(canonProjectRoot(undefined, true), '');
});

test('canonProjectRoot — POSIX backslashes get converted to forward', () => {
  // Edge case: file with backslash from Windows-origin metadata on a POSIX consumer
  assert.equal(canonProjectRoot('/Users\\Foo\\proj', false), '/Users/Foo/proj');
});

// Unit tests for renderer cross-platform shortcut display helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKey } from '../../renderer/src/lib/shortcut-format.js';

test('formatKey: Mod → ⌘ on darwin', () => {
  assert.equal(formatKey('Mod', 'darwin'), '⌘');
});

test('formatKey: Mod → Ctrl on Win/Linux/other', () => {
  assert.equal(formatKey('Mod', 'win32'), 'Ctrl');
  assert.equal(formatKey('Mod', 'linux'), 'Ctrl');
  assert.equal(formatKey('Mod', 'other'), 'Ctrl');
});

test('formatKey: Alt → ⌥ on darwin', () => {
  assert.equal(formatKey('Alt', 'darwin'), '⌥');
  assert.equal(formatKey('Alt', 'win32'), 'Alt');
});

test('formatKey: Shift → ⇧ on darwin', () => {
  assert.equal(formatKey('Shift', 'darwin'), '⇧');
  assert.equal(formatKey('Shift', 'linux'), 'Shift');
});

test('formatKey: Meta → ⌘ on darwin, Win on win32', () => {
  assert.equal(formatKey('Meta', 'darwin'), '⌘');
  assert.equal(formatKey('Meta', 'win32'), 'Win');
});

test('formatKey: literal characters unchanged', () => {
  assert.equal(formatKey('K', 'darwin'), 'K');
  assert.equal(formatKey('Enter', 'win32'), 'Enter');
  assert.equal(formatKey('↑', 'linux'), '↑');
  assert.equal(formatKey('/clear', 'darwin'), '/clear');
  assert.equal(formatKey('\\', 'win32'), '\\');
});

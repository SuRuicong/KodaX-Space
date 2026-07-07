import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readOptInBoolean, useAppStore } from '../../renderer/src/store/appStore.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('UI behavior toggles are opt-in by default', () => {
  assert.equal(readOptInBoolean(null), false);
  assert.equal(readOptInBoolean('0'), false);
  assert.equal(readOptInBoolean('true'), false);
  assert.equal(readOptInBoolean('1'), true);
});

test('UI behavior toggle setters persist explicit 1/0 values', () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
    },
  });

  useAppStore.getState().setSmartPopoutEnabled(true);
  assert.equal(values.get('kodax-space.smartPopoutEnabled'), '1');
  assert.equal(useAppStore.getState().smartPopoutEnabled, true);

  useAppStore.getState().setSmartPopoutEnabled(false);
  assert.equal(values.get('kodax-space.smartPopoutEnabled'), '0');
  assert.equal(useAppStore.getState().smartPopoutEnabled, false);

  useAppStore.getState().setNativeCompletionNotificationsEnabled(true);
  assert.equal(values.get('kodax-space.nativeCompletionNotificationsEnabled'), '1');
  assert.equal(useAppStore.getState().nativeCompletionNotificationsEnabled, true);

  useAppStore.getState().setNativeCompletionNotificationsEnabled(false);
  assert.equal(values.get('kodax-space.nativeCompletionNotificationsEnabled'), '0');
  assert.equal(useAppStore.getState().nativeCompletionNotificationsEnabled, false);
});

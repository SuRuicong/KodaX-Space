import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebContents } from 'electron';
import { installNavigationGuards } from '../window/navigation-guards.js';

type WindowOpenHandler = (details: { url: string }) => { action: 'deny' };
type NavigateHandler = (event: { preventDefault(): void }, url: string) => void;

function installGuard(deps: {
  readonly devServerUrl?: string;
  readonly allowedFilePrefix?: string;
  readonly allowedDataUrls?: readonly string[];
  readonly openExternal?: (url: string) => void;
}): {
  readonly openHandler: WindowOpenHandler;
  readonly navigate: (url: string) => boolean;
} {
  let openHandler: WindowOpenHandler | null = null;
  let navigateHandler: NavigateHandler | null = null;
  const wc = {
    setWindowOpenHandler(handler: WindowOpenHandler) {
      openHandler = handler;
    },
    on(event: string, handler: NavigateHandler) {
      if (event === 'will-navigate') navigateHandler = handler;
    },
  } as unknown as WebContents;

  installNavigationGuards(wc, {
    devServerUrl: deps.devServerUrl,
    allowedFilePrefix: deps.allowedFilePrefix ?? 'file:///app/',
    allowedDataUrls: deps.allowedDataUrls,
    openExternal: deps.openExternal ?? (() => undefined),
  });

  assert.ok(openHandler);
  assert.ok(navigateHandler);
  return {
    openHandler,
    navigate(url: string): boolean {
      let prevented = false;
      navigateHandler?.(
        {
          preventDefault() {
            prevented = true;
          },
        },
        url,
      );
      return prevented;
    },
  };
}

test('navigation guard allows only exact trusted data URLs', () => {
  const allowedDataUrl = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E';
  const guard = installGuard({ allowedDataUrls: [allowedDataUrl] });

  assert.equal(guard.navigate(allowedDataUrl), false);
  assert.equal(
    guard.navigate('data:text/html;charset=utf-8,%3Cscript%3Ealert(1)%3C%2Fscript%3E'),
    true,
  );
  assert.equal(guard.navigate(`${allowedDataUrl}%3Cscript%3Ealert(1)%3C%2Fscript%3E`), true);
});

test('navigation guard denies window.open and routes https externally', () => {
  const opened: string[] = [];
  const guard = installGuard({ openExternal: (url) => opened.push(url) });

  assert.deepEqual(guard.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.com']);
  assert.deepEqual(guard.openHandler({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.com']);
});

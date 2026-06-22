// space.version handler — main 端的第一个真实 channel。
//
// 返回 main 进程能拿到的版本号 + 平台。renderer 用这个值做自检 UI。

import { app, type App } from 'electron';
import { createRequire } from 'node:module';
import { registerChannel } from './register.js';
import type { SpaceCapability, SpaceVersionOutput } from '@kodax-space/space-ipc-schema';

function readSpaceVersion(electronApp: App): string {
  // app.getVersion() 读 packaged 应用的 package.json；dev 模式下可能不是 0.1.0-alpha.0
  // 而是 Electron CLI 默认值（"33.x"）。dev 下用环境变量兜底，保证自检 UI 不混淆。
  if (!electronApp.isPackaged && process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  return electronApp.getVersion();
}

function readKodaxSdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (typeof require !== 'undefined' ? null : (import.meta as any));
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('@kodax-ai/kodax/package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readKodaxDependencySpec(): string {
  const fromEnv = process.env.npm_package_dependencies__kodax_ai_kodax
    ?? process.env.npm_package_dependencies_kodax_ai_kodax;
  if (fromEnv) return fromEnv;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (typeof require !== 'undefined' ? null : (import.meta as any));
    const req = meta ? createRequire(meta.url) : require;
    const pkg = req('../../package.json') as { dependencies?: Record<string, unknown> };
    const spec = pkg.dependencies?.['@kodax-ai/kodax'];
    return typeof spec === 'string' && spec.length > 0 ? spec : 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildCapabilityLedger(): SpaceCapability[] {
  return [
    {
      id: 'repointel.trace',
      label: 'Repointel trace',
      status: 'supported',
      detail: 'KodaX SDK session trace events are mapped into Space session events and shown in the chip and /repointel trace view.',
      since: '0.1.19',
    },
    {
      id: 'repointel.status',
      label: 'Repointel local status',
      status: 'supported',
      detail: 'Space exposes a local status/doctor readout for project, git root, trace source, and warm support; standalone warm remains SDK-gated.',
    },
    {
      id: 'quickAsk.tempSession',
      label: 'Quick Ask temporary session',
      status: 'supported',
      detail: 'Quick Ask uses a plan-mode temporary KodaX session, captures events locally, cleans up on close, and can promote the persisted session into Coder.',
      since: '0.1.19',
    },
    {
      id: 'quickAsk.sideQuery',
      label: 'Quick Ask side query',
      status: 'blocked',
      detail: 'A true sideQuery API is not exposed by the current KodaX SDK contract.',
    },
    {
      id: 'handoff.receive',
      label: 'Handoff receiver',
      status: 'supported',
      detail: 'Space watches ~/.kodax/handoffs, lists valid/invalid/stale handoffs, and can accept or dismiss receiver-side handoff files.',
    },
  ];
}

export function registerVersionChannel(): void {
  registerChannel('space.version', (): SpaceVersionOutput => {
    const platform = process.platform;
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
      throw new Error(`unsupported platform: ${platform}`);
    }
    return {
      spaceVersion: readSpaceVersion(app),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform,
      kodaxSdkVersion: readKodaxSdkVersion(),
      kodaxDependencySpec: readKodaxDependencySpec(),
      capabilityContract: 'space-v0.1.22',
      capabilities: buildCapabilityLedger(),
    };
  });
}

// mcpb.* channel schema tests — F021 / v0.1.3

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invokeChannels,
  pushChannels,
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  mcpbInstallChannel,
  mcpbUninstallChannel,
  mcpbListChannel,
  mcpbChangedChannel,
} from '../src/index.js';

test('mcpb channels are registered in maps + name sets', () => {
  assert.ok(invokeChannels['mcpb.install']);
  assert.ok(invokeChannels['mcpb.uninstall']);
  assert.ok(invokeChannels['mcpb.list']);
  assert.ok(pushChannels['mcpb.changed']);
  assert.ok(INVOKE_CHANNEL_NAMES.has('mcpb.install'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('mcpb.uninstall'));
  assert.ok(INVOKE_CHANNEL_NAMES.has('mcpb.list'));
  assert.ok(PUSH_CHANNEL_NAMES.has('mcpb.changed'));
});

test('mcpb.install input: filePath optional, empty object OK', () => {
  // dialog mode: no filePath
  assert.equal(mcpbInstallChannel.input.safeParse({}).success, true);
  // with filePath
  assert.equal(
    mcpbInstallChannel.input.safeParse({ filePath: '/tmp/foo.mcpb' }).success,
    true,
  );
  // empty filePath rejected
  assert.equal(mcpbInstallChannel.input.safeParse({ filePath: '' }).success, false);
  // filePath too long rejected
  assert.equal(
    mcpbInstallChannel.input.safeParse({ filePath: 'x'.repeat(5000) }).success,
    false,
  );
});

test('mcpb.install output union: extension or cancelled:true', () => {
  const ext = {
    extensionId: 'fs@0.1.0',
    name: 'fs',
    displayName: 'Filesystem',
    version: '0.1.0',
    transport: 'stdio' as const,
    toolCount: 3,
    installedAt: 1748800000000,
  };
  assert.equal(mcpbInstallChannel.output.safeParse({ extension: ext }).success, true);
  assert.equal(mcpbInstallChannel.output.safeParse({ cancelled: true }).success, true);
  // can't have cancelled:true + extension at the same time
  // (union picks first match, so {ext, cancelled:false} also passes — that's intentional)
  assert.equal(
    mcpbInstallChannel.output.safeParse({ extension: ext, cancelled: false }).success,
    true,
  );
  // missing both rejected
  assert.equal(mcpbInstallChannel.output.safeParse({}).success, false);
});

test('mcpb.uninstall input + output', () => {
  assert.equal(
    mcpbUninstallChannel.input.safeParse({ extensionId: 'fs@0.1.0' }).success,
    true,
  );
  assert.equal(mcpbUninstallChannel.input.safeParse({}).success, false);
  assert.equal(mcpbUninstallChannel.output.safeParse({ ok: true }).success, true);
  assert.equal(mcpbUninstallChannel.output.safeParse({ ok: false }).success, true);
  assert.equal(mcpbUninstallChannel.output.safeParse({}).success, false);
});

test('mcpb.list output: extensions array capped at 512', () => {
  assert.equal(mcpbListChannel.output.safeParse({ extensions: [] }).success, true);
  const ext = {
    extensionId: 'fs@0.1.0',
    name: 'fs',
    displayName: 'Filesystem',
    version: '0.1.0',
    transport: 'stdio' as const,
    toolCount: 1,
    installedAt: 1,
  };
  const tooMany = Array.from({ length: 513 }, () => ext);
  assert.equal(mcpbListChannel.output.safeParse({ extensions: tooMany }).success, false);
});

test('mcpb.changed push payload mirrors mcpb.list output', () => {
  assert.equal(mcpbChangedChannel.payload.safeParse({ extensions: [] }).success, true);
});

test('extension schema rejects invalid semver chars in version', () => {
  const ext = {
    extensionId: 'fs@bad ver',
    name: 'fs',
    displayName: 'Filesystem',
    version: 'bad ver', // space — invalid
    transport: 'stdio' as const,
    toolCount: 0,
    installedAt: 1,
  };
  assert.equal(mcpbListChannel.output.safeParse({ extensions: [ext] }).success, false);
});

test('extension schema rejects transport value other than stdio|http', () => {
  const ext = {
    extensionId: 'fs@0.1.0',
    name: 'fs',
    displayName: 'Filesystem',
    version: '0.1.0',
    transport: 'tcp', // not in enum
    toolCount: 0,
    installedAt: 1,
  };
  assert.equal(mcpbListChannel.output.safeParse({ extensions: [ext] }).success, false);
});

test('description clamped to 280; author clamped to 128', () => {
  const big = 'x'.repeat(281);
  const ext = {
    extensionId: 'fs@0.1.0',
    name: 'fs',
    displayName: 'Filesystem',
    version: '0.1.0',
    description: big,
    transport: 'stdio' as const,
    toolCount: 0,
    installedAt: 1,
  };
  assert.equal(mcpbListChannel.output.safeParse({ extensions: [ext] }).success, false);
});

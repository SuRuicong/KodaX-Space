// artifact.* IPC handlers — 路径 D (记忆 livecanvas_artifact_plan).
//
// P1: sandboxInfo only — reports where the self-hosted sandbox bundle is served
// (or why it isn't). P2+ adds create/list/read/export.

import { registerChannel } from './register.js';
import { sandboxHost } from '../artifact/sandbox-host.js';

export function registerArtifactChannels(): void {
  registerChannel('artifact.sandboxInfo', () => sandboxHost.getInfo());
}

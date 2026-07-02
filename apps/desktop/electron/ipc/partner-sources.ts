import { promises as fs } from 'node:fs';
import { canonProjectRoot } from '@kodax-space/space-ipc-schema';
import { registerChannel } from './register.js';
import { projectStore } from '../projects/store.js';
import {
  resolveInsideProject,
  toPosixRelative,
} from './files-core.js';
import { kodaxHost } from '../kodax/host.js';
import { partnerSourceStore } from '../kodax/partner-source-store.js';

const IS_WIN = process.platform === 'win32';

function assertPartnerSessionIfActive(sessionId: string, projectRoot?: string): void {
  const session = kodaxHost.get(sessionId);
  if (!session) return;
  if (session.surface !== 'partner') {
    throw new Error(`session ${sessionId} is not a Partner session`);
  }
  if (
    projectRoot !== undefined &&
    canonProjectRoot(session.projectRoot, IS_WIN) !== canonProjectRoot(projectRoot, IS_WIN)
  ) {
    throw new Error('source projectRoot does not match the Partner session projectRoot');
  }
}

export function registerPartnerSourceChannels(): void {
  registerChannel('partner.sources.list', async (input) => {
    assertPartnerSessionIfActive(input.sessionId);
    return { sources: await partnerSourceStore.list(input.sessionId) };
  });

  registerChannel('partner.sources.add', async (input) => {
    const validatedRoot = await projectStore.assertAllowed(input.projectRoot);
    assertPartnerSessionIfActive(input.sessionId, validatedRoot);
    const realRoot = await fs.realpath(validatedRoot);
    const absPath = await resolveInsideProject(validatedRoot, input.path);
    const stat = await fs.stat(absPath);
    const actualTargetKind = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null;
    if (actualTargetKind === null) {
      throw new Error('Partner sources must be regular files or directories');
    }
    if (input.targetKind !== undefined && input.targetKind !== actualTargetKind) {
      throw new Error(`source targetKind mismatch: expected ${input.targetKind}, got ${actualTargetKind}`);
    }
    const source = await partnerSourceStore.addWorkspacePath({
      sessionId: input.sessionId,
      projectRoot: validatedRoot,
      path: toPosixRelative(absPath, realRoot),
      targetKind: actualTargetKind,
      ...(input.label !== undefined ? { label: input.label } : {}),
    });
    return { source };
  });

  registerChannel('partner.sources.remove', async (input) => {
    assertPartnerSessionIfActive(input.sessionId);
    return { removed: await partnerSourceStore.remove(input.sessionId, input.sourceId) };
  });
}

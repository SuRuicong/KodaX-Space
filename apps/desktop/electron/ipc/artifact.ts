// artifact.* IPC handlers — 路径 D + F057 数据层 (记忆 livecanvas_artifact_plan).
//
// sandboxInfo: where the self-hosted LC sandbox is served (P1, LC tier).
// create/list/read/delete: the LC-free artifact store (F057). create/delete push
// `artifact.changed` so the renderer refetches. The generation tool (F058) calls
// artifactStore directly (same singleton) rather than going through IPC.

import { registerChannel } from './register.js';
import { pushToRenderer } from './push.js';
import { sandboxHost } from '../artifact/sandbox-host.js';
import { artifactStore } from '../artifact/store.js';

export function registerArtifactChannels(): void {
  registerChannel('artifact.sandboxInfo', () => sandboxHost.getInfo());

  registerChannel('artifact.create', async (input) => {
    const res = await artifactStore.upsert(input);
    pushToRenderer('artifact.changed', {
      id: res.id,
      sessionId: input.sessionId,
      reason: res.created ? 'created' : 'version',
    });
    return { id: res.id, version: res.version };
  });

  registerChannel('artifact.list', async (input) => {
    const artifacts = await artifactStore.list(input ?? undefined);
    return { artifacts };
  });

  registerChannel('artifact.read', async (input) => {
    const res = await artifactStore.read(input.id, input.version);
    if (!res) {
      throw new Error(
        input.version !== undefined
          ? `artifact ${input.id} has no version ${input.version}`
          : `artifact not found: ${input.id}`,
      );
    }
    return res;
  });

  registerChannel('artifact.delete', async (input) => {
    const deleted = await artifactStore.delete(input.id);
    if (deleted) pushToRenderer('artifact.changed', { id: input.id, reason: 'deleted' });
    return { deleted };
  });
}

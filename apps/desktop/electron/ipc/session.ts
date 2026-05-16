// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import { registerChannel } from './register.js';
import { kodaxHost } from '../kodax/host.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

export function registerSessionChannels(): void {
  // session.create
  registerChannel('session.create', (input) => {
    const { sessionId, createdAt } = kodaxHost.createSession({
      projectRoot: input.projectRoot,
      provider: input.provider,
      reasoningMode: input.reasoningMode,
    });
    return { sessionId, createdAt };
  });

  // session.send
  registerChannel('session.send', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    // send 是 fire-and-forget——立刻 ACK，事件流通过 push 推
    await session.send(input.prompt);
    return { accepted: true } as const;
  });

  // session.cancel
  registerChannel('session.cancel', async (input) => {
    const cancelled = await kodaxHost.cancel(input.sessionId);
    return { cancelled };
  });

  // session.list
  registerChannel('session.list', () => {
    const sessions: SessionMeta[] = kodaxHost.list().map((s) => ({
      sessionId: s.sessionId,
      projectRoot: s.projectRoot,
      provider: s.provider,
      reasoningMode: s.reasoningMode,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
    }));
    return { sessions };
  });

  // session.delete
  registerChannel('session.delete', async (input) => {
    const deleted = await kodaxHost.delete(input.sessionId);
    return { deleted };
  });
}

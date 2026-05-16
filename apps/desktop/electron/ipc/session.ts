// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { kodaxHost } from '../kodax/host.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

export function registerSessionChannels(): void {
  // session.create
  registerChannel('session.create', (input) => {
    const projectRoot = validateProjectRoot(input.projectRoot);
    const { sessionId, createdAt } = kodaxHost.createSession({
      projectRoot,
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
    // 第一次 send 时自动给 session 起个临时标题（基于 prompt 头部）。
    // ensureTitle 已经在 host 里做"title === undefined 才填"的判断，重复调用安全。
    kodaxHost.ensureTitle(input.sessionId, input.prompt);
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
  // 可选 projectRoot 过滤——左抽屉切项目时只拉本项目下的 session。
  // 按 lastActivityAt 倒序，最近活动的在最前。
  registerChannel('session.list', (input) => {
    const projectFilter = input?.projectRoot;
    let list = kodaxHost.list();
    if (projectFilter) {
      list = list.filter((s) => s.projectRoot === projectFilter);
    }
    const sessions: SessionMeta[] = list
      .slice()
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((s) => ({
        sessionId: s.sessionId,
        projectRoot: s.projectRoot,
        provider: s.provider,
        reasoningMode: s.reasoningMode,
        title: s.title,
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

  // session.setTitle
  registerChannel('session.setTitle', (input) => {
    const ok = kodaxHost.setTitle(input.sessionId, input.title);
    return { ok };
  });
}

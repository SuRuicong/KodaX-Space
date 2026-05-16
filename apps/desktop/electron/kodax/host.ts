// KodaXHost — main 进程的 session 容器单例。
//
// 职责：
//   - 维护 Map<sessionId, ManagedSession>
//   - createSession(...) 用注入的 SessionFactory 生成实例（Mock / Real 都走这个口）
//   - 所有 session 事件通过 emit() 统一走 pushToRenderer('session.event', ...)
//   - 提供查询 / 取消 / 删除接口给 IPC handler 用
//
// 当前默认 factory：MockKodaXSession（F003 阶段）。
// 后续 chore：加 RealKodaXSession 实现并由配置开关切换。

import { randomUUID } from 'node:crypto';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import type { ManagedSession, SessionFactory } from './session-adapter.js';
import { MockKodaXSession } from './mock-session.js';

const defaultFactory: SessionFactory = (opts) => new MockKodaXSession(opts);

class KodaXHost {
  private readonly sessions = new Map<string, ManagedSession>();
  private factory: SessionFactory = defaultFactory;

  /** 覆盖默认 factory——测试用 Mock 工厂注入预制行为。*/
  setFactory(factory: SessionFactory): void {
    this.factory = factory;
  }

  /** 生成 session。返回 sessionId 与 createdAt。*/
  createSession(opts: {
    projectRoot: string;
    provider: string;
    reasoningMode?: 'off' | 'auto' | 'quick' | 'balanced' | 'deep';
  }): { sessionId: string; createdAt: number } {
    const sessionId = `s_${randomUUID()}`;
    const session = this.factory({
      sessionId,
      projectRoot: opts.projectRoot,
      provider: opts.provider,
      reasoningMode: opts.reasoningMode ?? 'auto',
      emit: (event: SessionEvent) => {
        // 统一从 host 这里 push——session 实现不直接知道 renderer 存在
        pushToRenderer('session.event', event);
      },
    });
    this.sessions.set(sessionId, session);
    return { sessionId, createdAt: session.createdAt };
  }

  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): readonly ManagedSession[] {
    return [...this.sessions.values()];
  }

  async cancel(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    await s.cancel();
    return true;
  }

  async delete(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    await s.dispose();
    this.sessions.delete(sessionId);
    return true;
  }

  /** 测试 / 关闭流程用：清空所有 session。*/
  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()));
    this.sessions.clear();
  }
}

// 单例。main.ts / handler / 测试都通过这个 instance 操作。
export const kodaxHost = new KodaXHost();

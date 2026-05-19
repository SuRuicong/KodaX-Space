// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import path from 'node:path';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { kodaxHost } from '../kodax/host.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';

/**
 * 校验 providerId 实际存在于 catalog / custom-providers / 是 'mock'。
 * review F008 C1-sec：schema 只验格式，不验存在性——必须 main 端再过一层。
 */
async function assertProviderExists(providerId: string): Promise<void> {
  if (providerId === 'mock') return;
  if (isBuiltinId(providerId)) return;
  await providerConfigStore.load();
  if (providerConfigStore.getCustom(providerId)) return;
  throw new Error(`unknown providerId: ${providerId}`);
}

export function registerSessionChannels(): void {
  // session.create
  registerChannel('session.create', async (input) => {
    const projectRoot = validateProjectRoot(input.projectRoot);
    await assertProviderExists(input.provider);
    const { sessionId, createdAt } = kodaxHost.createSession({
      projectRoot,
      provider: input.provider,
      reasoningMode: input.reasoningMode,
      permissionMode: input.permissionMode,
      autoModeEngine: input.autoModeEngine,
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
  //
  // 安全：
  //   - filter 同样过 validateProjectRoot——schema 只检字符串长度，
  //     不验证 abs path / no NUL / no ..
  //   - 用 path.normalize 后比较——避免 trailing slash / 大小写差异导致 filter miss
  //     （比如 session 存了 /Users/foo/proj，renderer 传 /Users/foo/proj/ 应该匹配）
  registerChannel('session.list', (input) => {
    let projectFilter: string | undefined;
    if (input?.projectRoot !== undefined) {
      projectFilter = path.normalize(validateProjectRoot(input.projectRoot));
    }
    let list = kodaxHost.list();
    if (projectFilter !== undefined) {
      list = list.filter((s) => path.normalize(s.projectRoot) === projectFilter);
    }
    const sessions: SessionMeta[] = list
      .slice()
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((s) => ({
        sessionId: s.sessionId,
        projectRoot: s.projectRoot,
        provider: s.provider,
        reasoningMode: s.reasoningMode,
        permissionMode: s.permissionMode,
        autoModeEngine: s.autoModeEngine,
        title: s.title,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        // FEATURE_033：fork child 才有；root 不带（undefined 经 zod 不出现在 JSON）
        parentSessionId: s.parentSessionId,
        forkPointTurnIdx: s.forkPointTurnIdx,
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

  // session.setReasoningMode — F008
  registerChannel('session.setReasoningMode', (input) => {
    const ok = kodaxHost.setReasoningMode(input.sessionId, input.mode);
    return { ok };
  });

  // session.setProvider — F008
  // 必须先验 providerId 真实存在——schema 只验格式，不验 catalog（review C1-sec）
  registerChannel('session.setProvider', async (input) => {
    await assertProviderExists(input.providerId);
    const ok = kodaxHost.setProvider(input.sessionId, input.providerId);
    return { ok };
  });

  // session.setPermissionMode — FEATURE_029 canonical 3 mode
  // 切 mode 立即生效（下次 tool call broker.request 走新 mode 短路）。
  registerChannel('session.setPermissionMode', (input) => {
    const ok = kodaxHost.setPermissionMode(input.sessionId, input.mode);
    return { ok };
  });

  // session.setAutoModeEngine — FEATURE_029
  // 切 auto mode 子档 engine ('llm' | 'rules')。即便当前 mode 不是 'auto' 也接受
  // (用户先选 engine 再切 auto 是合法路径)，下次进入 auto 时按新 engine bootstrap guardrail。
  registerChannel('session.setAutoModeEngine', (input) => {
    const ok = kodaxHost.setAutoModeEngine(input.sessionId, input.engine);
    return { ok };
  });

  // session.fork — FEATURE_033 (in-memory)
  // alpha.1 in-memory only：fork 出新 session，inherit source 运行时设置 + 标
  // parentSessionId/forkPointTurnIdx 元数据；events 复制由 renderer 完成。
  registerChannel('session.fork', (input) => {
    const result = kodaxHost.fork(input.sessionId, input.forkPointTurnIdx);
    if (!result) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    return result;
  });

  // session.rewind — FEATURE_033 (in-memory)
  // alpha.1 in-memory only：main 端 cancel in-flight（await）；renderer 截断 events。
  registerChannel('session.rewind', async (input) => {
    return kodaxHost.rewind(input.sessionId, input.rewindPastTurnIdx);
  });
}

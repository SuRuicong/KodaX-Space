// Session IPC handlers — F003
//
// 5 个 invoke channel 全部委托给 kodaxHost 单例处理。
// 所有 handler 在 registerChannel 内被 zod 包装（入参/出参/异常三路 envelope）。

import path from 'node:path';
import { registerChannel } from './register.js';
import { validateProjectRoot } from './validate.js';
import { kodaxHost } from '../kodax/host.js';
import { loadAgentsMd, type AgentsFile } from '../kodax/agents-md-loader.js';
import { loadKodaxUserDefaults } from '../kodax/user-config.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import type { AgentsFileMeta, SessionMeta } from '@kodax-space/space-ipc-schema';

// FEATURE_034 reviewer MEDIUM-2: 编译期保证 loader 的 AgentsFile 与 schema 的 AgentsFileMeta
// 结构一致——加字段、改 scope enum 等都会立即编译报错，不让 schema/loader 漂移。
// (双向 assignability：a→b 和 b→a 都必须成立，等同于结构等价。)
// 用 export 让 tsc noUnusedLocals 不报错（type-only export 不影响 runtime）
export type _AssertAgentsFileShapeEqual =
  AgentsFile extends AgentsFileMeta
    ? AgentsFileMeta extends AgentsFile
      ? true
      : never
    : never;

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
      agentMode: input.agentMode,
    });
    // v0.1.6 cleanup: 用 ~/.kodax/config.json 的 thinking 默认值初始化新 session。
    // 不传 schema 改动——renderer 没必要知道 thinking 默认值，main 直接 fill 即可。
    // model 不在这里 fill：跨 provider 切换时 KodaX config 里的 model 名通常对不上
    // 用户在 Space 选的 provider；要正确填要做 provider×model 映射，留 v0.1.7+。
    try {
      const kodaxDefaults = await loadKodaxUserDefaults();
      if (kodaxDefaults.thinking !== undefined) {
        kodaxHost.setThinking(sessionId, kodaxDefaults.thinking);
      }
    } catch (err) {
      console.warn(
        '[session.create] kodax defaults fill failed:',
        err instanceof Error ? err.message : err,
      );
    }
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
  registerChannel('session.list', async (input) => {
    // reviewer MEDIUM-3: projectFilter 必须在传给 listMerged 前 normalize，
    // 让 SDK 层和 IPC 层比较同一形态（避免 Windows 路径 / 大小写 / trailing
    // slash 不一致让 persisted session 静默丢失）。
    let projectFilter: string | undefined;
    if (input?.projectRoot !== undefined) {
      projectFilter = path.normalize(validateProjectRoot(input.projectRoot));
    }
    // FEATURE_038: 合并视图 — in-flight (in-memory) ∪ SDK persisted
    const merged = await kodaxHost.listMerged({ projectRoot: projectFilter });
    // persisted session 没有 lastActivityAt——用 createdAt 占位（同一时间精度排序）
    const withTs = merged
      .filter((m) => {
        if (projectFilter === undefined) return true;
        if (m.kind === 'in-flight') {
          return path.normalize(m.projectRoot) === projectFilter;
        }
        // persisted 的 projectRoot 来自 SDK runtimeInfo.workspaceRoot ?? gitRoot；
        // 缺省时 acceptable 过掉——SDK 应当在 listSessions(projectRoot) 那层已过滤
        return m.projectRoot !== undefined && path.normalize(m.projectRoot) === projectFilter;
      })
      .map((m) => {
        if (m.kind === 'in-flight') {
          return { item: m, sortKey: m.lastActivityAt };
        }
        // persisted: SDK 给 ISO date string；缺省 → 0（最旧）
        const ts = m.createdAt !== undefined ? Date.parse(m.createdAt) : 0;
        return { item: m, sortKey: Number.isFinite(ts) ? ts : 0 };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
    const sessions: SessionMeta[] = withTs.map(({ item, sortKey }) => {
      if (item.kind === 'in-flight') {
        return {
          sessionId: item.sessionId,
          projectRoot: item.projectRoot,
          provider: item.provider,
          reasoningMode: item.reasoningMode,
          permissionMode: item.permissionMode,
          autoModeEngine: item.autoModeEngine,
          agentMode: item.agentMode,
          title: item.title,
          createdAt: item.createdAt,
          lastActivityAt: item.lastActivityAt,
          parentSessionId: item.parentSessionId,
          forkPointTurnIdx: item.forkPointTurnIdx,
        };
      }
      // persisted: 运行时设置用 schema default 占位（permissionMode/autoModeEngine 走 .default()）；
      // provider/reasoningMode 没 default——schema 要求 → 给 'mock' 与 'auto' 占位。
      //
      // TODO(F039 / v0.1.7) reviewer MEDIUM-1: 用户在 sidebar 点 historical session
      // 触发"加载到内存"流程时会替换为真实运行时设置；在那之前 'mock' provider 占位
      // 是 latent footgun（renderer 若直接拿来 setProvider 之类操作可能误路由）。
      // 选项：换成 '__unloaded__' 之类 sentinel 让 schema 拒绝、强制 renderer 走
      // activate flow 才能用这条 session。
      return {
        sessionId: item.sessionId,
        projectRoot: item.projectRoot ?? '/',
        provider: 'mock',
        reasoningMode: 'auto',
        permissionMode: 'accept-edits',
        autoModeEngine: 'llm',
        agentMode: 'ama',
        title: item.title,
        createdAt: sortKey,
        lastActivityAt: sortKey,
      };
    });
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

  // session.setAgentMode — 切 KodaX agent 形态 (AMA / SA)。
  // AMA = 多 agent 协作（KodaX 默认）；SA = 单 agent 降级路径，接口并发受限时使用。
  // 切换不重启 in-flight session，下一条 prompt 走新形态。
  registerChannel('session.setAgentMode', (input) => {
    const ok = kodaxHost.setAgentMode(input.sessionId, input.agentMode);
    return { ok };
  });

  // session.fork — FEATURE_038 (持久化)
  // v0.1.6: SDK forkSession 写盘出新 sessionId；host 用 source 运行时设置实例化
  // 新 ManagedSession 入 in-memory map。events 复制仍由 renderer 完成（重启后从
  // SDK loadSession 重放是 v0.1.7+ 优化）。
  registerChannel('session.fork', async (input) => {
    const result = await kodaxHost.fork(input.sessionId, input.forkPointTurnIdx);
    if (!result) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    return result;
  });

  // session.rewind — FEATURE_038 (持久化)
  // v0.1.6: main 端 cancel in-flight (await)，然后 SDK rewindSession 写盘截断；
  // renderer 截断 events 数组。
  registerChannel('session.rewind', async (input) => {
    return kodaxHost.rewind(input.sessionId, input.rewindPastTurnIdx);
  });

  // session.agentsMd — FEATURE_034
  // 拉取 session.projectRoot 下当前的 AGENTS.md 列表 (global + project)。
  // 每次都重 load（disk stat + read）—— 不缓存，让 AGENTS.md 修改后下次 popout 打开即生效。
  // 安全：projectRoot 在 session.create 已经 validateProjectRoot 过，这里复用 session 持有的值，
  // 不让 renderer 直接传任意路径。
  // **async**：v0.1.6 后 loadAgentsMd 走 SDK loadAgentsFiles (同步 I/O)，保留 async
  // 包装兼容 handler 签名；SDK 抛任何异常都被 loader try/catch 转空数组 (reviewer HIGH-2)。
  registerChannel('session.agentsMd', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const files = await loadAgentsMd({ projectRoot: session.projectRoot });
    return { files };
  });
}

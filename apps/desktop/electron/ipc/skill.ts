// Skill IPC handlers — FEATURE_035.
//
// 启动 main 时 main.ts 调 registerSkillChannels()，注册 skill.discover + skill.invoke。

import { registerChannel } from './register.js';
import { kodaxHost } from '../kodax/host.js';
import { getSkillRegistry, invalidateSkillCache, toSkillMeta } from '../skill/registry.js';
import { createSkillDynamicContextExecutor } from '../skill/dynamic-context-executor.js';

/**
 * 安全 env：**完全不转发** process.env 给 SDK VariableResolver。
 *
 * 起因（reviewer F035 CRITICAL-1）：providers/keys.ts 启动期把 ANTHROPIC_API_KEY /
 * KIMI_API_KEY 等 secret 注入 process.env 让 KodaX runtime 能拿到；若同时把
 * process.env 喂给 SkillRegistry.invoke 的 VariableContext.environment，恶意 SKILL.md
 * 用 `${ANTHROPIC_API_KEY}` 模板就能把密钥拼进 resolvedPrompt 走 session.send 流出。
 *
 * SDK 内部仍会注入 KODAX_SESSION_ID / CLAUDE_SESSION_ID / KODAX_WORKING_DIR，不依赖
 * 我们传入。用户级 ${MY_VAR} 替换暂不支持——alpha.1 不开 user-defined env 通道；
 * 后续若要加，应当走 per-skill frontmatter `env:` whitelist 显式声明，不能直通进程 env。
 */
const SAFE_ENV: Record<string, string> = {};

/**
 * 拼回 args 字符串。SDK VariableResolver 处理 $1..$N (按空格切的 token) +
 * $ARGUMENTS (整段原文)。renderer 端 tokenizeArgs 已经按空格 + 双引号切好；
 * 这里 join 成 SDK 期望的 "raw text"。
 */
function joinArgs(args: readonly string[]): string {
  return args.join(' ');
}

export function registerSkillChannels(): void {
  // skill.discover
  // 列 user-invocable skill（不含 disableModelInvocation 的）。
  // 输入 projectRoot —— 不依赖 live SDK session：用户从 Recents 恢复历史会话时
  // UI 有 sessionId 但 kodaxHost 没对应 session；discover 是只读操作不需要 live session。
  registerChannel('skill.discover', async (input) => {
    // v0.1.10: forceReload=true 时清掉 wrapper cache, 让下次 getSkillRegistry new 一个
    // SkillRegistry instance + 触发 SDK discover() 重 scan 磁盘。
    // 用户 dogfood 报: skill-creator 生成新 skill 后必须重启 Space 才能 / 补全, 因为
    // wrapper cache TTL 60s + SDK 单 instance 不 re-scan。
    if (input.forceReload) {
      invalidateSkillCache(input.projectRoot);
    }
    const registry = await getSkillRegistry(input.projectRoot);
    const skills = registry.listUserInvocable().map(toSkillMeta);
    return { skills };
  });

  // skill.invoke
  // SDK SkillRegistry.invoke 内部做 markdown 解析 + VariableResolver；输出 SkillInvokeResult
  // { success, content, error } 映射到 IPC envelope。
  //
  // 安全设计 (v0.7.42 起):
  //   旧版 (alpha.1): refuseIfUnsafeContent 一律拒绝含 `!`cmd`` token 的 skill (SDK 用
  //   execSync 跑这些命令,完全绕过 F029/F030 permission broker)。**过度限制**: 实用 skill
  //   大量需要 git log / find 等命令查询当前 repo 状态。
  //   现在 (v0.1.x): 传 executeDynamicContext hook → 每个 !`cmd` 走 permissionBroker
  //   弹窗征求批准 → 用户授权后 spawn 跑 → stdout 回 SDK 继续解析。
  //
  // 不再传 SAFE_ENV={} (改成 {}+session env)，而是: SDK 解析 ${VAR} 时如果 environment
  // 是空对象,${ANTHROPIC_API_KEY} 等都 resolve 成空串,密钥不会进 resolvedPrompt。维持原 secure stance。
  registerChannel('skill.invoke', async (input) => {
    let session = kodaxHost.get(input.sessionId);
    if (!session) {
      // v0.1.10 fix: 同 session.send 的 lazy resume 路径 — sessionId 不在 in-flight
      // 但磁盘 persisted (重启后历史 session,用户报 "session not found" bug)。
      // 否则用户重启 Space → 从 Recents 点击 → 输入 /skill-name 立刻 HANDLER_ERROR。
      const resumed = await kodaxHost.tryResume(input.sessionId);
      if (!resumed) {
        throw new Error(`session not found: ${input.sessionId}`);
      }
      session = kodaxHost.get(input.sessionId);
      if (!session) {
        throw new Error(`session resume failed: ${input.sessionId}`);
      }
    }
    const registry = await getSkillRegistry(session.projectRoot);

    // 用当前 session 的 permissionMode 创建 executor; 'plan' mode 下任何 !`cmd` 会被 broker
    // 直接 deny (符合 plan-mode 语义 — 只规划不执行)
    const executor = createSkillDynamicContextExecutor({
      sessionId: input.sessionId,
      permissionMode: session.permissionMode,
    });

    const result = await registry.invoke(input.skillName, joinArgs(input.args), {
      sessionId: input.sessionId,
      workingDirectory: session.projectRoot,
      environment: SAFE_ENV,
      executeDynamicContext: executor,
    });
    if (!result.success) {
      return { ok: false, error: result.error ?? 'skill invocation failed' };
    }
    return { ok: true, resolvedPrompt: result.content };
  });
}

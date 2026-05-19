// Skill IPC handlers — FEATURE_035.
//
// 启动 main 时 main.ts 调 registerSkillChannels()，注册 skill.discover + skill.invoke。

import { registerChannel } from './register.js';
import { kodaxHost } from '../kodax/host.js';
import { getSkillRegistry, toSkillMeta, refuseIfUnsafeContent } from '../skill/registry.js';

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
  registerChannel('skill.discover', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const registry = await getSkillRegistry(session.projectRoot);
    const skills = registry.listUserInvocable().map(toSkillMeta);
    return { skills };
  });

  // skill.invoke
  // SDK SkillRegistry.invoke 内部已做 markdown 解析 + VariableResolver；
  // 输出 SkillInvokeResult { success, content, error } 映射到 IPC envelope。
  // 不在这里直接 session.send —— resolvedPrompt 返回给 renderer，让 UI 走
  // appendUserMessage + session.send 一条龙，保证 conversation stream 里能看到该 prompt。
  //
  // 安全前置检查（reviewer F035 CRITICAL-2）：在调 SDK invoke 前 scan SKILL.md
  // 是否含 `!`cmd`` dynamic-context 模板。SDK 内部用 execSync 跑这些命令，**完全**
  // 绕过 F029/F030 permission broker——alpha.1 阶段一律拒绝，让用户的 shell 触发
  // 仍然走 KodaX runtime 的 tool call 路径（broker 守门）。
  registerChannel('skill.invoke', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    const registry = await getSkillRegistry(session.projectRoot);
    const refusal = await refuseIfUnsafeContent(registry, input.skillName);
    if (refusal) {
      return { ok: false, error: refusal };
    }
    const result = await registry.invoke(input.skillName, joinArgs(input.args), {
      sessionId: input.sessionId,
      workingDirectory: session.projectRoot,
      environment: SAFE_ENV,
    });
    if (!result.success) {
      return { ok: false, error: result.error ?? 'skill invocation failed' };
    }
    return { ok: true, resolvedPrompt: result.content };
  });
}

// Slash command IPC handler — FEATURE_031.
//
// 启动时 main.ts 调 registerSlashChannels()，注册表的填充 (registerSlash) 由
// registerBuiltinSlashCommands 在同 init 阶段完成。

import { registerChannel } from './register.js';
import { getSlashHandler, listSlashCommands, registerSlash } from '../slash/registry.js';
import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin.js';
import { kodaxHost } from '../kodax/host.js';
import { assertSessionSendScope } from './session.js';
import type { ChannelInput, ChannelOutput } from '@kodax-space/space-ipc-schema';

/**
 * 启动 main 时调一次：把所有 builtin 命令塞进 registry。
 * Test 也可以调（先 _resetSlashRegistryForTesting 再重新填）。
 */
export function registerBuiltinSlashCommands(): void {
  for (const cmd of BUILTIN_SLASH_COMMANDS) {
    registerSlash(cmd);
  }
}

type SlashExecInput = ChannelInput<'slash.exec'>;
type SlashExecOutput = ChannelOutput<'slash.exec'>;

async function ensureSessionAvailableForSlash(sessionId: string): Promise<void> {
  if (kodaxHost.get(sessionId)) return;
  try {
    await kodaxHost.tryResume(sessionId);
  } catch (err) {
    console.warn('[slash.exec] lazy resume failed:', err instanceof Error ? err.message : err);
  }
}

export async function executeSlashCommand(input: SlashExecInput): Promise<SlashExecOutput> {
  const handler = getSlashHandler(input.name);
  if (!handler) {
    return {
      ok: false,
      message: `unknown command: /${input.name}`,
      unknownCommand: true,
    };
  }
  await ensureSessionAvailableForSlash(input.sessionId);
  const session = kodaxHost.get(input.sessionId);
  if (session) {
    assertSessionSendScope(session, {
      expectedProjectRoot: input.expectedProjectRoot,
      expectedSurface: input.expectedSurface,
    });
  }
  return handler.handler({
    sessionId: input.sessionId,
    args: input.args,
  });
}
export function registerSlashChannels(): void {
  // slash.discover — renderer 取最新命令列表 (builtin + 未来 user/.kodax/commands)
  registerChannel('slash.discover', () => {
    // schema 期望 mutable array；registry 返回 readonly。spread 复制成 mutable
    return { commands: [...listSlashCommands()] };
  });

  // slash.exec — 执行命令。handler 内部自己做参数校验 + 返回 ok/message/echo。
  //
  // 不在这里加 try/catch：handler 异常会冒泡到 registerChannel 的统一捕获，
  // 走 IpcResult fail('HANDLER_ERROR', ...)（见 ipc/register.ts:44）。重复包一层
  // 既绕过统一 sanitisation，又会把内部错误对象的 message 字段直送 renderer。
  registerChannel('slash.exec', executeSlashCommand);
}

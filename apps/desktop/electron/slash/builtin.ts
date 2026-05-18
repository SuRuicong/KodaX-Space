// Builtin slash command handlers — FEATURE_031.
//
// 第一批 8 个对齐 KodaX REPL：
//   /mode <plan|accept-edits|auto>      切 permission mode
//   /auto-engine <llm|rules>            切 auto sub-engine
//   /model <name>                       (留 placeholder：F029 schema 暂未 model 字段)
//   /provider <name>                    切 provider (kodaxHost.setProvider)
//   /reasoning <off|auto|quick|balanced|deep>
//   /thinking <on|off>                  (留 placeholder：thinking 字段未在 session schema)
//   /clear                              主动 emit 'session_clear' (renderer 自决清屏)
//   /help                               列出所有命令
//
// 实现哲学：每个 handler 只调 host setter + emit 提示事件；renderer 看到事件再渲染。
// 不在 main 做"美化输出"——和 KodaX REPL 一样保持 main 端最小职责。

import type { PermissionMode, AutoModeEngine } from '@kodax-space/space-ipc-schema';
import type { SlashCommandDef } from './registry.js';
import { kodaxHost } from '../kodax/host.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import { listSlashCommands } from './registry.js';

const REASONING_MODES = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
type ReasoningMode = (typeof REASONING_MODES)[number];

const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'accept-edits', 'auto'];
const AUTO_ENGINES: readonly AutoModeEngine[] = ['llm', 'rules'];

function isPermissionMode(s: string): s is PermissionMode {
  return PERMISSION_MODES.includes(s as PermissionMode);
}

function isAutoEngine(s: string): s is AutoModeEngine {
  return AUTO_ENGINES.includes(s as AutoModeEngine);
}

function isReasoningMode(s: string): s is ReasoningMode {
  return REASONING_MODES.includes(s as ReasoningMode);
}

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandDef[] = [
  {
    name: 'mode',
    description: 'Switch permission mode (plan / accept-edits / auto)',
    argsHint: '<plan|accept-edits|auto>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { ok: false, message: 'Usage: /mode <plan|accept-edits|auto>' };
      }
      if (!isPermissionMode(target)) {
        return { ok: false, message: `unknown mode '${target}'; valid: ${PERMISSION_MODES.join(', ')}` };
      }
      const ok = kodaxHost.setPermissionMode(ctx.sessionId, target);
      return ok
        ? { ok: true, message: `mode → ${target}` }
        : { ok: false, message: `session not found: ${ctx.sessionId}` };
    },
  },

  {
    name: 'auto-engine',
    description: 'Switch auto-mode classifier engine (llm / rules)',
    argsHint: '<llm|rules>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { ok: false, message: 'Usage: /auto-engine <llm|rules>' };
      }
      if (!isAutoEngine(target)) {
        return { ok: false, message: `unknown engine '${target}'; valid: ${AUTO_ENGINES.join(', ')}` };
      }
      const ok = kodaxHost.setAutoModeEngine(ctx.sessionId, target);
      return ok
        ? { ok: true, message: `auto-engine → ${target}` }
        : { ok: false, message: `session not found: ${ctx.sessionId}` };
    },
  },

  {
    name: 'provider',
    description: 'Switch provider (must exist in catalog or custom)',
    argsHint: '<provider-id>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { ok: false, message: 'Usage: /provider <provider-id>' };
      }
      // 走 session.setProvider 等价的 catalog 检查 (review F008 C1-sec)
      if (target !== 'mock' && !isBuiltinId(target)) {
        await providerConfigStore.load();
        if (!providerConfigStore.getCustom(target)) {
          return { ok: false, message: `unknown providerId: ${target}` };
        }
      }
      const ok = kodaxHost.setProvider(ctx.sessionId, target);
      return ok
        ? { ok: true, message: `provider → ${target}` }
        : { ok: false, message: `session not found: ${ctx.sessionId}` };
    },
  },

  {
    name: 'reasoning',
    description: 'Switch reasoning mode',
    argsHint: '<off|auto|quick|balanced|deep>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { ok: false, message: `Usage: /reasoning <${REASONING_MODES.join('|')}>` };
      }
      if (!isReasoningMode(target)) {
        return { ok: false, message: `unknown reasoning '${target}'; valid: ${REASONING_MODES.join(', ')}` };
      }
      const ok = kodaxHost.setReasoningMode(ctx.sessionId, target);
      return ok
        ? { ok: true, message: `reasoning → ${target}` }
        : { ok: false, message: `session not found: ${ctx.sessionId}` };
    },
  },

  {
    name: 'model',
    description: 'Switch model (FEATURE_029 schema not yet introduces per-session model; preview only)',
    argsHint: '<model-name>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { ok: false, message: 'Usage: /model <model-name>' };
      }
      // F-future: schema 引入 session.model 后调 host.setModel；此前返回 not-supported
      return {
        ok: false,
        message: `not supported yet — current session uses provider default. ` +
          `Tracked in FEATURE_029 follow-up (per-session model setter).`,
      };
    },
  },

  {
    name: 'thinking',
    description: 'Toggle thinking output (FEATURE_029 schema not yet introduces per-session thinking flag; preview only)',
    argsHint: '<on|off>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (target !== 'on' && target !== 'off') {
        return { ok: false, message: 'Usage: /thinking <on|off>' };
      }
      return {
        ok: false,
        message: `not supported yet — KodaX provider default applies. ` +
          `Tracked in FEATURE_029 follow-up (per-session thinking toggle).`,
      };
    },
  },

  {
    name: 'clear',
    description: 'Clear current session message view (does not delete session)',
    source: 'builtin',
    handler: async (ctx) => {
      // 实际清屏由 renderer 端决定——main 仅确认 sessionId 有效并通过 clearStream=true
      // 显式请求 renderer 清空 eventsBySession/userMessagesBySession。
      // 用独立 flag 而非 name 匹配是为了 F035 user 命令可能同名 'clear' 时不出歧义。
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: 'cleared', echo: true, clearStream: true };
    },
  },

  {
    name: 'help',
    description: 'List all available slash commands',
    source: 'builtin',
    handler: async () => {
      const cmds = listSlashCommands();
      // 把命令列表当 message 文本返回——renderer 渲染时按行 split 显示
      const lines = cmds.map((c) => {
        const hint = c.argsHint ? ` ${c.argsHint}` : '';
        return `/${c.name}${hint} — ${c.description}`;
      });
      return {
        ok: true,
        message: `Available commands (${cmds.length}):\n${lines.join('\n')}`,
        echo: true,
      };
    },
  },
];

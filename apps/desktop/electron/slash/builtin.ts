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

import type { PermissionMode, AutoModeEngine, AgentMode } from '@kodax-space/space-ipc-schema';
import type { SlashCommandDef } from './registry.js';
import { kodaxHost } from '../kodax/host.js';
import { isBuiltinId } from '../providers/catalog.js';
import { providerConfigStore } from '../providers/config.js';
import { listSlashCommands } from './registry.js';
import { getKodaxProviderModelsAndDefault } from '../kodax/sdk-providers.js';

const REASONING_MODES = ['off', 'auto', 'quick', 'balanced', 'deep'] as const;
type ReasoningMode = (typeof REASONING_MODES)[number];

const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'accept-edits', 'auto'];
const AUTO_ENGINES: readonly AutoModeEngine[] = ['llm', 'rules'];
const AGENT_MODES: readonly AgentMode[] = ['ama', 'sa'];

function isPermissionMode(s: string): s is PermissionMode {
  return PERMISSION_MODES.includes(s as PermissionMode);
}

function isAutoEngine(s: string): s is AutoModeEngine {
  return AUTO_ENGINES.includes(s as AutoModeEngine);
}

function isReasoningMode(s: string): s is ReasoningMode {
  return REASONING_MODES.includes(s as ReasoningMode);
}

function isAgentMode(s: string): s is AgentMode {
  return AGENT_MODES.includes(s as AgentMode);
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
    description: 'Override model for next turn. Use /model default to clear, /model list to see options.',
    argsHint: '<model-name | default | list>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      const session = kodaxHost.get(ctx.sessionId);
      if (!session) return { ok: false, message: `session not found: ${ctx.sessionId}` };

      // Lazy lookup provider model list — 失败时退化为"接受任意 string"(不阻塞用户),
      // 但成功时校验 + 给"did you mean"提示。
      const providerId = session.provider;
      const providerInfo = await getKodaxProviderModelsAndDefault(providerId).catch(() => null);

      if (!target) {
        // 无参数: 列出当前 provider 下的可用 model + 当前选中值
        const currentModel = session.model ?? providerInfo?.defaultModel ?? '(provider default)';
        const list = providerInfo?.models ?? [];
        if (list.length === 0) {
          return {
            ok: false,
            message: `Usage: /model <model-name | default | list>\nCurrent: ${currentModel} (no model list for provider ${providerId})`,
          };
        }
        return {
          ok: false,
          message: [
            `Usage: /model <model-name | default | list>`,
            `Current: ${currentModel}`,
            `Available for ${providerId}:`,
            ...list.map((m) => `  • ${m}${m === currentModel ? ' ← current' : ''}`),
          ].join('\n'),
        };
      }

      // 'list' 等价于无参 — 输出可用 model 列表。OpenRouter 这种 provider 可能给 200+ model,
      // 输出超 2048 字符 schema 上限会被 envelope 拒。取前 30 个 + 提示总数。
      if (target === 'list') {
        const list = providerInfo?.models ?? [];
        if (list.length === 0) {
          return { ok: false, message: `No model list available for provider ${providerId}` };
        }
        const currentModel = session.model ?? providerInfo?.defaultModel;
        const MAX_DISPLAY = 30;
        const shown = list.slice(0, MAX_DISPLAY);
        const overflow = list.length - shown.length;
        return {
          ok: true,
          message: [
            `Models for ${providerId} (${list.length} total):`,
            ...shown.map((m) => `  • ${m}${m === currentModel ? ' ← current' : ''}`),
            ...(overflow > 0 ? [`  … +${overflow} more (use /model <name> to switch directly)`] : []),
            `(use /model <name> to switch, /model default to clear)`,
          ].join('\n'),
          echo: true,
        };
      }

      // 'default' 清除 override
      const isClear = target === 'default';
      if (isClear) {
        const ok = kodaxHost.setModel(ctx.sessionId, undefined);
        if (!ok) return { ok: false, message: `session not found: ${ctx.sessionId}` };
        return { ok: true, message: 'model → provider default (cleared override)' };
      }

      // 真实 model 名 — 校验在可用列表里。如果 provider 没暴露列表则放过 (保守 fallback)。
      if (providerInfo && providerInfo.models.length > 0 && !providerInfo.models.includes(target)) {
        // 简单 prefix-match suggest 一个最接近的
        const lower = target.toLowerCase();
        const suggestion = providerInfo.models.find((m) => m.toLowerCase().startsWith(lower))
          ?? providerInfo.models.find((m) => m.toLowerCase().includes(lower));
        return {
          ok: false,
          message: [
            `Unknown model "${target}" for provider ${providerId}.`,
            suggestion ? `Did you mean: ${suggestion}?` : '',
            `Available: ${providerInfo.models.join(', ')}`,
          ].filter(Boolean).join('\n'),
        };
      }

      const ok = kodaxHost.setModel(ctx.sessionId, target);
      if (!ok) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      return { ok: true, message: `model → ${target} (applies on next send)` };
    },
  },

  {
    name: 'thinking',
    description: 'Toggle thinking output for next turn (v0.7.42 SDK wired).',
    argsHint: '<on | off>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (target !== 'on' && target !== 'off') {
        return { ok: false, message: 'Usage: /thinking <on | off>' };
      }
      const ok = kodaxHost.setThinking(ctx.sessionId, target === 'on');
      if (!ok) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      return { ok: true, message: `thinking → ${target} (applies on next send)` };
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
    name: 'agent-mode',
    description: 'Switch agent orchestration mode (ama=multi-agent / sa=single-agent)',
    argsHint: '<ama|sa>',
    source: 'builtin',
    handler: async (ctx) => {
      const target = ctx.args[0];
      if (!target) return { ok: false, message: 'Usage: /agent-mode <ama|sa>' };
      if (!isAgentMode(target)) {
        return { ok: false, message: `unknown agent mode '${target}'; valid: ${AGENT_MODES.join(', ')}` };
      }
      const ok = kodaxHost.setAgentMode(ctx.sessionId, target);
      return ok
        ? { ok: true, message: `agent mode → ${target}` }
        : { ok: false, message: `session not found: ${ctx.sessionId}` };
    },
  },

  {
    name: 'new',
    description: 'Start a new session in the current project (current chat remains in Recents)',
    source: 'builtin',
    handler: async (ctx) => {
      // 实际"新建 session"动作在 renderer 端做（需要 provider/reasoningMode 等当前
      // pending 值）。slash 这里只 echo 一个 system_notice，renderer 监听 message 含
      // `__action__:new-session` 触发 LeftSidebar.handleNewSession 等价逻辑。
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return {
        ok: true,
        message: '__action__:new-session',
        echo: false,
      };
    },
  },

  {
    name: 'copy',
    description: 'Copy the last assistant message to clipboard (renderer handles)',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      // renderer 端 SlashCommandPopover/onSlashPick 监听到 __action__:copy-last 时执行 clipboard 拷贝
      return { ok: true, message: '__action__:copy-last', echo: false };
    },
  },

  {
    name: 'cost',
    description: 'Show estimated token usage / cost for current session',
    source: 'builtin',
    handler: async (ctx) => {
      const s = kodaxHost.get(ctx.sessionId);
      if (!s) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      // 本地汇总 iter / token 数据走 renderer (它有 events buffer)；main 端
      // 没有 token 累加器，发个 action 让 renderer 自己渲染。
      return { ok: true, message: '__action__:show-cost', echo: false };
    },
  },

  {
    name: 'compact',
    description: 'Request context compaction on next turn (spikes token budget to force trigger)',
    argsHint: '',
    source: 'builtin',
    handler: async (ctx) => {
      const s = kodaxHost.get(ctx.sessionId);
      if (!s) return { ok: false, message: `session not found: ${ctx.sessionId}` };
      // 设置 flag — real-session 下一次 runKodaX 时通过 contextTokenSnapshot 把 currentTokens
      // 顶到 999B (远超任何 contextWindow),让 SDK 的 needsCompaction 立即返回 true → 触发
      // auto-compaction。完事后 real-session 清掉 flag。
      // 比真正 manual SDK 调用 (DefaultSummaryCompaction + applySessionCompaction) 简单太多,
      // 缺点是必须用户至少再输入一条消息才生效。后续如 SDK 出"compactNow"原子调用再升级。
      kodaxHost.requestCompact(ctx.sessionId);
      return {
        ok: true,
        message: 'Compaction requested — will trigger on your next message.',
        echo: true,
      };
    },
  },

  {
    name: 'tree',
    description: 'Show current session fork lineage tree',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: '__action__:show-tree', echo: false };
    },
  },

  {
    name: 'history',
    description: 'List user messages in current session',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      return { ok: true, message: '__action__:show-history', echo: false };
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

  {
    name: 'repointel',
    description: 'Show recent KodaX repo-intelligence trace events',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      // renderer 端 dispatchSlashAction 读 events buffer 抽 repointel_trace
      return { ok: true, message: '__action__:show-repointel', echo: false };
    },
  },

  {
    name: 'doctor',
    description: 'Diagnose providers (key configured + HTTP probe + context window)',
    source: 'builtin',
    handler: async () => {
      // renderer 端汇总 provider.list + provider.test 结果做诊断报告
      return { ok: true, message: '__action__:show-doctor', echo: false };
    },
  },

  {
    name: 'status',
    description: 'Show other KodaX peer instances (other Space windows / CLI / REPL running)',
    source: 'builtin',
    handler: async () => {
      // renderer 调 session.listRunning + 输出格式化的 peer 列表
      return { ok: true, message: '__action__:show-status', echo: false };
    },
  },

  {
    name: 'review',
    description: 'Insert a review template + current uncommitted diff for LLM review',
    source: 'builtin',
    handler: async () => {
      // renderer 端拉 git diff (project.gitDiff IPC) → 拼模板 → 塞入输入框
      // SDK 的 runLlmReview 是给 self-modify handler 安全审查用的 (FEATURE_088 capability whitelist),
      // 对 Space 用户场景不适用; 这里实现 user-facing /review = "review my changes" 助手。
      return { ok: true, message: '__action__:insert-review-template', echo: false };
    },
  },

  {
    name: 'memory',
    description: 'Show loaded AGENTS.md files (global + project)',
    source: 'builtin',
    handler: async (ctx) => {
      if (!kodaxHost.get(ctx.sessionId)) {
        return { ok: false, message: `session not found: ${ctx.sessionId}` };
      }
      // renderer 调 session.agentsMd 拉清单
      return { ok: true, message: '__action__:show-memory', echo: false };
    },
  },
];

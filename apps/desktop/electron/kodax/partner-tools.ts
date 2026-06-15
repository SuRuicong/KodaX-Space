// F047 — Partner (non-bash-subset) 工具策略。
import type { PermissionMode, Surface } from '@kodax-space/space-ipc-schema';

//
// Partner doc-workspace 是「读 + 研究」面：允许只读检索 + web 研究，阻断 bash / edit / write
// 等任何会改文件系统 / 跑 shell / 派生 subagent 的工具。
//
// **基于 SDK 能力维度元数据**（ADR-007 R3）：2026-06-13 实测 SDK 已暴露
// `resolveToolCapability(toolName): ToolCapability`（tier = 'read' | 'edit' | 'bash:*' |
// 'subagent'，未知名 fail-closed 到 'subagent'）。Partner 放行 tier === 'read'，即只读检索
// （read/grep/glob/repo-intel/symbol... 新增只读工具自动流过，不必维护硬编码名单）。
//
// web 研究工具（web_fetch/web_search）的 tier 不是 'read'（含网络副作用），但 Partner 研究
// 场景需要 → 单列显式 allow。这是当前 ToolCapability tier 没有独立 'network' 档的 workaround；
// 若 SDK 后续把 web 归一个明确只读-网络 tier，可移除此显式集。退场点见 [[kodax_sdk_export_gaps]]。
//
// fail-closed：tier 非 'read' 且不在 web allow 集 → 一律阻断（含 SDK 新增的 mutation/shell
// 工具、未知 MCP 工具），与 plan-mode 的 fail-closed 哲学一致——安全边界宁可过严不可漏。

/** Partner 显式允许的网络研究工具（tier 非 'read'，但 Partner 研究需要）。 */
export const PARTNER_NETWORK_ALLOW: ReadonlySet<string> = new Set(['web_fetch', 'web_search']);

/**
 * Partner 显式允许的 Space 自有工具（F058）。`create_artifact` 是 Space 注册的
 * in-process 工具（sideEffect='mutates-state'，写 Space 自有 artifact store，不碰项目 FS），
 * resolveToolCapability 对它 fail-closed 到 'subagent' → 不显式放行就会被拦。Partner 产出
 * 报告/文档/图表正是核心场景,故放行。
 */
export const PARTNER_SPACE_TOOL_ALLOW: ReadonlySet<string> = new Set(['create_artifact']);

/**
 * Partner surface 是否允许调用某工具。
 *
 * @param toolName  SDK 工具名（planModeBlockCheck 收到的同款名）
 * @param capability  SDK `resolveToolCapability(toolName)` 的结果（caller 注入，便于纯单测）
 */
export function isPartnerToolAllowed(toolName: string, capability: string): boolean {
  if (PARTNER_NETWORK_ALLOW.has(toolName)) return true;
  if (PARTNER_SPACE_TOOL_ALLOW.has(toolName)) return true;
  return capability === 'read';
}

/**
 * 统一的工具拦截决策——real-session 的 `context.planModeBlockCheck` 闭包调它。返回 block
 * reason（喂回 LLM 让它别再调），null = 放行。把 Partner 白名单 + plan-mode 两种限制收敛到
 * 一处纯函数，便于单测两者交互。
 *
 * **关键（review HIGH）**：Partner surface 下，Partner 白名单**就是最严约束**（只 read+web），
 * plan-mode **不再二次裁剪**——否则 plan mode 会把 web_fetch/web_search 也拦掉（它们 plan-mode
 * 不允许），违背 Partner"web 研究恒可用"的设计。故 Partner-allowed 直接 return null。
 *
 * SDK 查询用 thunk 注入，保持惰性（capability 仅 Partner 求值；planModeAllowed 仅 Coder+plan
 * 求值）+ 可单测（注入 fake）。
 */
export function computeToolBlockReason(args: {
  readonly surface: Surface;
  readonly permissionMode: PermissionMode;
  readonly tool: string;
  readonly resolveCapability: () => string;
  readonly isPlanModeAllowed: () => boolean;
}): string | null {
  const { surface, permissionMode, tool, resolveCapability, isPlanModeAllowed } = args;
  if (surface === 'partner') {
    if (!isPartnerToolAllowed(tool, resolveCapability())) {
      return `[partner] tool '${tool}' is not available in the Partner doc-workspace (read / search / web only). Describe the outcome instead of running it.`;
    }
    return null; // Partner 白名单已是最严约束；plan-mode 不再二次裁剪（否则误拦 web 研究）
  }
  if (permissionMode !== 'plan') return null;
  // SDK isToolPlanModeAllowed: readonly / planModeAllowed:true → allowed; 其他 → blocked
  // Fail-closed: 未知 tool 返回 false（一律 block）
  if (isPlanModeAllowed()) return null;
  return `[plan] tool '${tool}' is blocked. Plan mode allows only read/search tools — describe the plan instead of executing it.`;
}

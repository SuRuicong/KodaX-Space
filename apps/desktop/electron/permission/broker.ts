// PermissionBroker — main 端的 ask-and-wait 协调器 — FEATURE_007
//
// 职责：
//   1) KodaX runtime 触发 permission callback → broker.request({...}) → 返回 Promise<decision>
//   2) Broker 生成 reqId、推 permission.request 给 renderer、把 (reqId → { resolve, sessionId })
//      记入 pending Map
//   3) Renderer 走 invoke 'permission.answer' → handler 调 broker.resolve(reqId, decision)
//      → 等待的 Promise resolve
//   4) Session 取消 / 删除 / 进程退出时调 broker.cancelSession(sid) → 自动 deny 所有该 session
//      pending + 推 permission.cancelled 让 UI 关弹窗
//
// 设计点：
//   - reqId 用 randomUUID()——避免 renderer 端竞态时把答案对到错的 request
//   - Always-allow 规则在 broker.request() 第一步检查；命中则**完全不**弹窗，直接 resolve
//     'allow_once'（不重新写规则）。这是 F007 验收里"下次同 pattern 不再弹"的实现点
//   - 危险命令（assessment.dangerous=true）即使有规则也**仍然弹窗**——always-allow 不应当
//     覆盖危险命令；这是 defense-in-depth 第二层
//   - 超时：默认 5 分钟无响应自动 deny（防 renderer 崩了导致 KodaX 永远卡住）

import { randomUUID } from 'node:crypto';
import type {
  PermissionDecision,
  PermissionMode,
  PermissionRisk,
} from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { assessRisk, suggestAlwaysAllowPattern } from './risk.js';
import { permissionRegistry } from './registry.js';
import { sanitizeForDisplay, sanitizeInputForDisplay } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface PermissionRequestInput {
  readonly sessionId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  /** alpha.1：session 当前 permissionMode；缺省按 'ask-permissions' 走 alpha.0 行为。*/
  readonly mode?: PermissionMode;
  /** 超时毫秒数；不传走 DEFAULT_TIMEOUT_MS。测试可调小。*/
  readonly timeoutMs?: number;
}

// alpha.1 mode 行为表：accept-edits 时这些工具名自动 allow_once（dangerous 仍走弹窗）。
// 命名贴近 KodaX 内核约定 + Claude Code 通用名。Real adapter 接入后可能扩展（如 multi_edit / str_replace）。
const EDIT_TOOLS = new Set(['edit', 'write', 'multi_edit', 'str_replace']);

export interface PermissionResolved {
  readonly decision: PermissionDecision;
  readonly pattern?: string;
  readonly risk: PermissionRisk;
}

interface PendingEntry {
  readonly reqId: string;
  readonly sessionId: string;
  readonly risk: PermissionRisk;
  /** main 端为本次调用生成的 allow-always pattern；renderer 提交的 pattern 一律忽略（C2-sec）。*/
  readonly trustedPattern: string | undefined;
  readonly resolve: (r: PermissionResolved) => void;
  readonly timer: NodeJS.Timeout;
}

class PermissionBroker {
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * 工具调用前的 gate。返回 decision；调用方根据 decision 决定是否真的执行 tool。
   *
   * 'allow_once' / 'allow_always' → 调用方继续执行
   * 'deny'                         → 调用方放弃，emit tool_result 带 "permission denied"
   *
   * review H2-code（2026-05-17）：在 matches() 前显式 await load()。
   * registry.load() 是 idempotent 的（cached !== null 时立即返回），后续调用零成本。
   * 这关闭了"启动早期 main.ts void load() 还没完成但 session 已经发起 tool 调用"的窗口——
   * 该窗口里 matches() 会返回 false 然后强弹窗（安全侧），但显式 await 杜绝未来误优化的风险
   */
  async request(req: PermissionRequestInput): Promise<PermissionResolved> {
    const assessment = assessRisk(req.toolName, req.input);
    const mode: PermissionMode = req.mode ?? 'ask-permissions';

    // alpha.1 mode-aware 短路（在 always-allow 规则之前）：
    //
    //   plan-mode          → 全 deny，agent 只能 plan 不能执行
    //   bypass-permissions → 全 allow，跳过 always-allow 规则、危险检测都不走（UI 端通过
    //                        settings flag 解锁选择；main 端信任 UI 传入）
    //   accept-edits       → edit/write 自动批，dangerous 仍走弹窗（rm -rf 等不能 silent 跳过）
    //   ask-permissions    → 走 alpha.0 原逻辑（always-allow 规则 + 危险弹窗）
    if (mode === 'plan-mode') {
      return { decision: 'deny', risk: assessment.risk };
    }
    if (mode === 'bypass-permissions') {
      // 全放——记 warn 日志便于事后审计，但不弹窗
      console.warn(
        `[permission-broker] bypass mode: ${req.toolName} auto-allowed without prompt (session=${req.sessionId})`,
      );
      return { decision: 'allow_once', risk: assessment.risk };
    }
    if (mode === 'accept-edits' && !assessment.dangerous && EDIT_TOOLS.has(req.toolName)) {
      return { decision: 'allow_once', risk: assessment.risk };
    }

    // ask-permissions（默认） + accept-edits 中 dangerous / 非 edit 工具：走原逻辑

    // 确保规则已加载——idempotent，已加载时立即返回
    await permissionRegistry.load();

    // 已批准且非危险 — 跳过弹窗
    if (!assessment.dangerous && permissionRegistry.matches(req.toolName, req.input)) {
      return { decision: 'allow_once', risk: assessment.risk };
    }

    const reqId = randomUUID();
    const suggestedPattern = suggestAlwaysAllowPattern(req.toolName, req.input, assessment);

    return new Promise<PermissionResolved>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          pushToRenderer('permission.cancelled', {
            reqId,
            sessionId: req.sessionId,
            reason: 'timeout',
          });
          resolve({ decision: 'deny', risk: assessment.risk });
        }
      }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      // unref 防止 setTimeout 阻止进程退出（broker 的超时不应当 keep-alive event loop）
      if (typeof timer.unref === 'function') timer.unref();

      this.pending.set(reqId, {
        reqId,
        sessionId: req.sessionId,
        risk: assessment.risk,
        trustedPattern: suggestedPattern,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        timer,
      });

      // review H3-sec：清洗显示用字段。原始 input 已经被 assessRisk 用过，
      // 这里清洗只影响 modal 显示——不影响危险检测结果
      const safeToolName = sanitizeForDisplay(req.toolName, 128) || '(unnamed)';
      const safeReason = sanitizeForDisplay(assessment.reason, 512);
      const safeInput = sanitizeInputForDisplay(req.input);

      pushToRenderer('permission.request', {
        reqId,
        sessionId: req.sessionId,
        risk: assessment.risk,
        reason: safeReason,
        toolCall: {
          toolId: req.toolId,
          toolName: safeToolName,
          input: safeInput,
        },
        suggestedPattern,
      });
    });
  }

  /**
   * 查询某 pending entry 的可信元数据。
   * Handler 在调用 resolve 前用这个拿 trustedPattern——renderer 提交的 pattern 字段一律忽略。
   * 不存在时返回 undefined。
   */
  peek(reqId: string): { trustedPattern: string | undefined; sessionId: string; risk: PermissionRisk } | undefined {
    const entry = this.pending.get(reqId);
    if (!entry) return undefined;
    return {
      trustedPattern: entry.trustedPattern,
      sessionId: entry.sessionId,
      risk: entry.risk,
    };
  }

  /**
   * Renderer 回答时调用。reqId 不存在（超时 / session 已取消）返回 false。
   *
   * 注意（review C2-sec）：不再接受 renderer-supplied pattern。Handler 应当先
   * 调 peek() 拿 trustedPattern，自己处理持久化，再调 resolve 通知 session 继续。
   * Broker 只承诺把 decision + risk 传回等待的 promise。
   */
  resolve(reqId: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    this.pending.delete(reqId);
    entry.resolve({
      decision,
      pattern: decision === 'allow_always' ? entry.trustedPattern : undefined,
      risk: entry.risk,
    });
    return true;
  }

  /**
   * Session 取消 / 删除时调用：所有该 session 的 pending 自动 deny。
   * renderer 收到 permission.cancelled 后应关闭弹窗。
   */
  cancelSession(sessionId: string, reason: 'session_cancelled' | 'session_disposed' | 'shutdown'): void {
    const toCancel: PendingEntry[] = [];
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) toCancel.push(entry);
    }
    for (const entry of toCancel) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('permission.cancelled', {
        reqId: entry.reqId,
        sessionId,
        reason,
      });
      entry.resolve({ decision: 'deny', risk: entry.risk });
    }
  }

  /**
   * 进程退出兜底：所有 pending 全部 deny + 推 permission.cancelled 给 renderer
   * 关弹窗（review M2-sec：原本不推 cancelled，renderer modal queue 残留）。
   * 在 app.before-quit 调用——保证 disposeAll 循环被中断时也能清理。
   */
  cancelAll(reason: 'shutdown'): void {
    const entries = [...this.pending.values()];
    for (const entry of entries) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('permission.cancelled', {
        reqId: entry.reqId,
        sessionId: entry.sessionId,
        reason,
      });
      entry.resolve({ decision: 'deny', risk: entry.risk });
    }
  }

  /** 测试 / 调试：当前 pending 数。*/
  pendingCount(): number {
    return this.pending.size;
  }
}

export const permissionBroker = new PermissionBroker();

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
  PermissionRisk,
} from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { assessRisk, suggestAlwaysAllowPattern } from './risk.js';
import { permissionRegistry } from './registry.js';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface PermissionRequestInput {
  readonly sessionId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  /** 超时毫秒数；不传走 DEFAULT_TIMEOUT_MS。测试可调小。*/
  readonly timeoutMs?: number;
}

export interface PermissionResolved {
  readonly decision: PermissionDecision;
  readonly pattern?: string;
  readonly risk: PermissionRisk;
}

interface PendingEntry {
  readonly reqId: string;
  readonly sessionId: string;
  readonly risk: PermissionRisk;
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
   */
  async request(req: PermissionRequestInput): Promise<PermissionResolved> {
    const assessment = assessRisk(req.toolName, req.input);

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
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        timer,
      });

      pushToRenderer('permission.request', {
        reqId,
        sessionId: req.sessionId,
        risk: assessment.risk,
        reason: assessment.reason,
        toolCall: {
          toolId: req.toolId,
          toolName: req.toolName,
          input: req.input,
        },
        suggestedPattern,
      });
    });
  }

  /**
   * Renderer 回答时调用。reqId 不存在（超时 / session 已取消）返回 false。
   */
  resolve(reqId: string, decision: PermissionDecision, pattern?: string): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    this.pending.delete(reqId);
    entry.resolve({
      decision,
      pattern: decision === 'allow_always' ? pattern : undefined,
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

  /** 进程退出兜底：所有 pending 全部 deny。*/
  cancelAll(reason: 'shutdown'): void {
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve({ decision: 'deny', risk: entry.risk });
    }
    void reason;
  }

  /** 测试 / 调试：当前 pending 数。*/
  pendingCount(): number {
    return this.pending.size;
  }
}

export const permissionBroker = new PermissionBroker();

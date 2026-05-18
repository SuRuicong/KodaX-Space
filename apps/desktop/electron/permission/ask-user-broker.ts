// AskUserBroker — FEATURE_032
//
// 配合 KodaX `AutoModeAskUser` 接口（FEATURE_030 wire 时使用）。当 guardrail / agent
// 需要主动问用户时，调 askUserBroker.request → 推 'askUser.request' push → 等 renderer
// 回 'askUser.reply' → resolve Promise。
//
// 跟 PermissionBroker 故意分两个 broker：
//   - permissionBroker: 每次 tool call 都过 gate（频次高、UI 直接显示 input 字段）
//   - askUserBroker:    guardrail 升级 / ask_user_question tool 主动问（频次低、问题文本 + signals）
//
// 两个 broker 共用 ipc/push.js 推送，schema 各自独立 channel，UI 各自 modal。
//
// 设计点：
//   - reqId 用 randomUUID()，杜绝 renderer 端竞态错配
//   - 默认 60s 超时 → block (安全侧)。比 permissionBroker 的 5 分钟更紧，因为
//     askUser 通常是 guardrail 升级路径，agent 不应当卡太久
//   - session cancel / dispose 自动 block 所有该 session 的 pending
//   - 进程退出 cancelAll 兜底

import { randomUUID } from 'node:crypto';
import type { AskUserVerdict, AskUserSignal, AskUserToolCall } from '@kodax-space/space-ipc-schema';
import { pushToRenderer } from '../ipc/push.js';
import { sanitizeForDisplay, sanitizeInputForDisplay } from './sanitize.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface AskUserRequestInput {
  readonly sessionId: string;
  readonly reason: string;
  readonly toolCall: AskUserToolCall;
  readonly signals?: readonly AskUserSignal[];
  /** 测试可调小。*/
  readonly timeoutMs?: number;
}

interface PendingAskUser {
  readonly reqId: string;
  readonly sessionId: string;
  readonly resolve: (verdict: AskUserVerdict) => void;
  readonly timer: NodeJS.Timeout;
}

class AskUserBroker {
  private readonly pending = new Map<string, PendingAskUser>();

  /**
   * 主动问用户。返回 Promise<verdict>。
   * 超时 / session cancel / shutdown 时自动 resolve 'block' 并推 cancelled push 让 modal 关闭。
   */
  request(req: AskUserRequestInput): Promise<AskUserVerdict> {
    const reqId = randomUUID();

    return new Promise<AskUserVerdict>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          pushToRenderer('askUser.cancelled', {
            reqId,
            sessionId: req.sessionId,
            reason: 'timeout',
          });
          resolve('block');
        }
      }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();

      this.pending.set(reqId, {
        reqId,
        sessionId: req.sessionId,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        timer,
      });

      // sanitize 仅影响 modal 显示——main 端 KodaX 调用上下文不变
      const safeToolName = sanitizeForDisplay(req.toolCall.toolName, 128) || '(unnamed)';
      const safeReason = sanitizeForDisplay(req.reason, 2048);
      const safeInput = sanitizeInputForDisplay(req.toolCall.input);
      // 信号 message 现在是 KodaX 静态分析输出 (trusted)；但若未来路径有用户控制内容渗透，
      // 这一层 sanitize 兜底——剥 RTL override / 控制字符 / 零宽，保证 UI 显示安全。
      const safeSignals = req.signals?.map((s) => ({
        type: sanitizeForDisplay(s.type, 64),
        severity: s.severity,
        message: sanitizeForDisplay(s.message, 512),
      }));

      pushToRenderer('askUser.request', {
        reqId,
        sessionId: req.sessionId,
        reason: safeReason,
        toolCall: {
          toolId: req.toolCall.toolId,
          toolName: safeToolName,
          input: safeInput,
        },
        signals: safeSignals,
      });
    });
  }

  /**
   * Renderer 回答时调。不存在的 reqId（超时已 block / session 已 cancel）返回 false。
   */
  resolve(reqId: string, verdict: AskUserVerdict): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    this.pending.delete(reqId);
    entry.resolve(verdict);
    return true;
  }

  /**
   * Session 取消 / 删除：该 session 的所有 pending 自动 block + 推 cancelled。
   */
  cancelSession(
    sessionId: string,
    reason: 'session_cancelled' | 'session_disposed' | 'shutdown',
  ): void {
    const toCancel: PendingAskUser[] = [];
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) toCancel.push(entry);
    }
    for (const entry of toCancel) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('askUser.cancelled', {
        reqId: entry.reqId,
        sessionId,
        reason,
      });
      entry.resolve('block');
    }
  }

  /**
   * 进程退出兜底：所有 pending block + 通知 renderer 关 modal。
   */
  cancelAll(reason: 'shutdown'): void {
    const entries = [...this.pending.values()];
    for (const entry of entries) {
      this.pending.delete(entry.reqId);
      clearTimeout(entry.timer);
      pushToRenderer('askUser.cancelled', {
        reqId: entry.reqId,
        sessionId: entry.sessionId,
        reason,
      });
      entry.resolve('block');
    }
  }

  /** 测试 / 调试：当前 pending 数。*/
  pendingCount(): number {
    return this.pending.size;
  }
}

export const askUserBroker = new AskUserBroker();

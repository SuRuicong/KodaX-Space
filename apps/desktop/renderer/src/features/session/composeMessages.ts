// composeMessages —— 把 SessionEvent[] + UserMessage[] 编织成 ConversationMessage[]。
//
// 输入语义：
//   - events 是 main 推过来的有序 push 事件流（thinking_delta / text_delta / tool_start /
//     tool_progress / tool_result / iteration_end / session_complete / session_error）
//   - userMessages 是 renderer 本地记录的"用户发的 prompt"（main 不通过 push 回放）
//   - userMessages 的 sentAt 与 event 时间在同一 wall-clock；merge 时按时间穿插
//
// 输出语义：
//   - 一条 ConversationMessage 对应 UI 上一个气泡 / 卡片
//   - assistant 文本：连续 text_delta 合成一条 assistant_text 气泡（直到被
//     tool_start / iteration_end / session_complete 等"中断"）
//   - thinking：附在最近的 assistant_text 上（或独立 stub）
//   - tool_start 开新 tool_call 卡；后续 tool_progress / tool_result 更新它
//   - iteration_end / session_complete / session_error 走 system_notice
//
// 设计原则：纯函数。给定相同输入产相同输出，便于 useMemo + 单元测试。

import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import type { UserMessage, WorkflowNoticeMessage } from '../../store/appStore.js';

export type ConversationMessage =
  | { kind: 'user'; id: string; content: string; sentAt: number }
  | {
      kind: 'assistant_text';
      id: string;
      /** 累积的 text_delta 拼接结果；用于 markdown 渲染。*/
      text: string;
      /** 累积的 thinking_delta 拼接（如果有）。*/
      thinking?: string;
      /**
       * 该轮对话的近似时间戳——继承自触发本轮的 user message sentAt。
       * 用于 message footer 显示 "6d ago" 之类相对时间。assistant 实际完成时间没存
       * （events 没时间戳），用 user 时间近似在 dashboard 视角无感差异。
       */
      sentAt?: number;
    }
  | {
      kind: 'tool_call';
      id: string;
      toolId: string;
      toolName: string;
      input?: Record<string, unknown>;
      result?: string;
      progress?: string;
      status: 'running' | 'done';
    }
  | {
      kind: 'system_notice';
      id: string;
      variant: 'iteration' | 'error' | 'sidecar' | 'workflow';
      /** iteration: "iter 1/30 · 1280 tokens"; error: 错误文本；sidecar: verifier 可读消息。
       *  v0.1.x: 'complete' variant 已废弃——assistant bubble footer 自带 "Xd ago"，
       *  原来的横条 "✓ complete" 视觉太重、对每轮都打断阅读节奏。 */
      text: string;
      /** OC-11: error variant 携带的 wrapSdkError 分类。SystemNotice 据此渲染按钮。*/
      action?: 'retry' | 'open_provider_settings' | 'check_network' | 'change_model';
      retriable?: boolean;
      /** OC-23 倒计时：retry 按钮在此 epoch ms 之前 disabled + 显示 "Retry in Ns"。
       *  Main 端在 emit session_error 时已 stamp = Date.now() + waitMs，selector 这里
       *  直接透传 evt.retryAvailableAt 不再加工，避免 composeMessages 每次重跑都让倒计时
       *  漂移 (review HIGH-2 修复后的定型形态)。*/
      retryAvailableAt?: number;
    };

interface ComposeInput {
  readonly events: readonly SessionEvent[];
  readonly userMessages: readonly UserMessage[];
  readonly workflowNotices?: readonly WorkflowNoticeMessage[];
}

export function composeMessages({
  events,
  userMessages,
  workflowNotices = [],
}: ComposeInput): ConversationMessage[] {
  const result: ConversationMessage[] = [];

  // 把 userMessages 转成"带时间戳的虚拟事件"——便于和 events 按时序穿插。
  // events 没有自带时间戳，但它们的顺序 = push 顺序 = 时间顺序；
  // 用户消息是用户主动 send 出去之后才有的 events，所以一个 user message 之后跟着一串 events 直到下一个 user message。
  // 简化的做法：按 sentAt 把 user messages 切片，每片之后追加对应时段的 events。
  // 但 events 没时间戳，我们没法精确切。退而求其次：先 emit 所有 user messages，再 emit
  // 所有 events，会让对话看起来"用户消息全在最前"——这不对。
  //
  // 正确做法：events 按收到顺序，user messages 也按顺序；两条流交叉时机是"用户每发一条 prompt，
  // 后续 events 都属于这条 prompt 的响应，直到下一条 prompt 出现"。换言之，第 N 条 user message
  // 之后的所有 events，在第 N+1 条 user message 之前。
  //
  // 为了实现这个，我们假设 user messages 按发送顺序，events 也按到达顺序：
  //   - 在每条 user message 后，截取属于它的 events 子序列
  //   - 子序列的边界：到 session_complete / session_error 算这段结束；或者下一条 user message 出现
  //
  // 当前 mock + future real adapter 都会在每次 send 结束时 emit session_complete 或 session_error，
  // 所以"按 session_complete/error 切段"是稳定的边界。

  let cursor = 0;
  const localMessages = [
    ...userMessages.map((userMsg, order) => ({
      kind: 'user' as const,
      sentAt: userMsg.sentAt,
      order,
      userMsg,
    })),
    ...workflowNotices.map((notice, order) => ({
      kind: 'workflow_notice' as const,
      sentAt: notice.sentAt,
      order: userMessages.length + order,
      notice,
    })),
  ].sort((a, b) => a.sentAt - b.sentAt || a.order - b.order);

  for (const local of localMessages) {
    if (local.kind === 'workflow_notice') {
      result.push({
        kind: 'system_notice',
        id: local.notice.id,
        variant: 'workflow',
        text: local.notice.content,
      });
      continue;
    }

    const userMsg = local.userMsg;
    result.push({
      kind: 'user',
      id: userMsg.id,
      content: userMsg.content,
      sentAt: userMsg.sentAt,
    });

    // 找这条 user message 对应的 events 段：从 cursor 起，到遇到
    // session_complete / session_error / 或所有 events 用完。
    const segmentEnd = findSegmentEnd(events, cursor);
    const segment = events.slice(cursor, segmentEnd);
    cursor = segmentEnd;
    composeAssistantSegment(segment, result, userMsg.sentAt);
  }
  if (cursor < events.length) {
    composeAssistantSegment(events.slice(cursor), result);
  }

  return result;
}

/** events[cursor..] 里找下一段的结束位置（不包含）：到 session_complete / session_error 之后 */
function findSegmentEnd(events: readonly SessionEvent[], cursor: number): number {
  for (let i = cursor; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'session_complete' || e.kind === 'session_error') {
      // 防御性：把**紧跟的连续终止事件**一并并入本段，而不是只吃一个。
      // 单个用户轮次理论上只产一个终止事件，但 SDK AMA 错误路径曾一次冒出
      // error + complete（+ 重复 error）多个终止事件（见 real-session.ts 收口注释）。
      // 若只 return i+1，多出来的终止事件会被算进**下一条** user message 的段里，
      // 导致后续 user ↔ event 配对整体错位（错误挂错气泡、回复被甩到列表底部）。
      // 主修复在 main 端收口；这里再兜一道，保证即便多终止事件也留在同一段、位置正确。
      let end = i + 1;
      while (
        end < events.length &&
        (events[end].kind === 'session_complete' || events[end].kind === 'session_error')
      ) {
        end++;
      }
      return end;
    }
  }
  return events.length;
}

/** 把一段 events 编织成 assistant 气泡 + tool cards + system notice 序列 */
function composeAssistantSegment(
  segment: readonly SessionEvent[],
  out: ConversationMessage[],
  parentSentAt?: number,
): void {
  let currentText: {
    kind: 'assistant_text';
    id: string;
    text: string;
    thinking?: string;
    sentAt?: number;
  } | null = null;
  // tool_call 卡片按 toolId 查找——同一个 toolId 的 start/progress/result 合并到一张卡
  const toolCardsByToolId = new Map<string, Extract<ConversationMessage, { kind: 'tool_call' }>>();

  // 每段开头计数器从 0 起，id 用 segment idx + offset，避免不同段的 id 冲撞
  const segmentTag = `seg${out.length}`;
  let textBubbleCounter = 0;
  let noticeCounter = 0;

  function flushTextBubble(): void {
    if (currentText) {
      out.push(currentText);
      currentText = null;
    }
  }

  for (const evt of segment) {
    switch (evt.kind) {
      case 'text_delta': {
        if (!currentText) {
          currentText = {
            kind: 'assistant_text',
            id: `${segmentTag}_text${textBubbleCounter++}`,
            text: '',
            sentAt: parentSentAt,
          };
        }
        currentText.text += evt.text;
        break;
      }
      case 'thinking_delta': {
        if (!currentText) {
          currentText = {
            kind: 'assistant_text',
            id: `${segmentTag}_text${textBubbleCounter++}`,
            text: '',
            sentAt: parentSentAt,
          };
        }
        currentText.thinking = (currentText.thinking ?? '') + evt.text;
        break;
      }
      case 'tool_start': {
        flushTextBubble();
        const card: Extract<ConversationMessage, { kind: 'tool_call' }> = {
          kind: 'tool_call',
          id: `${segmentTag}_tool_${evt.toolId}`,
          toolId: evt.toolId,
          toolName: evt.toolName,
          input: evt.input,
          status: 'running',
        };
        toolCardsByToolId.set(evt.toolId, card);
        out.push(card);
        break;
      }
      case 'tool_progress': {
        const card = toolCardsByToolId.get(evt.toolId);
        if (card) card.progress = evt.message;
        break;
      }
      case 'tool_result': {
        const card = toolCardsByToolId.get(evt.toolId);
        if (card) {
          card.result = evt.content;
          card.status = 'done';
        }
        break;
      }
      case 'iteration_end': {
        // iter/token 数据由 BottomBar 的 ActivitySpinner + ContextWindowIndicator
        // 持续显示，对话流不再插 system_notice — 避免每轮中间出现 "iter 1/200 · 14k tokens"
        // 分隔线打断阅读节奏（用户反馈：状态栏有就够了）。
        flushTextBubble();
        break;
      }
      case 'session_complete': {
        // v0.1.x: 不再 push '✓ complete' 横条；assistant bubble footer 显示 "Xd ago"
        // + copy 按钮替代，视觉更轻。consume 但不 emit。
        flushTextBubble();
        break;
      }
      case 'sidecar_message': {
        flushTextBubble();
        const title =
          evt.message.delivery === 'budget-exhausted'
            ? 'Sidecar budget exhausted'
            : evt.message.verdict === 'revise'
              ? 'Sidecar verifier requested revision'
              : 'Sidecar verifier blocked completion';
        const suggestedFix = evt.message.suggestedFix
          ? ` Suggested fix: ${evt.message.suggestedFix}`
          : '';
        out.push({
          kind: 'system_notice',
          id: `${segmentTag}_sidecar${noticeCounter++}`,
          variant: 'sidecar',
          text: `${title}: ${evt.message.content}${suggestedFix}`,
        });
        break;
      }
      case 'session_error': {
        flushTextBubble();
        out.push({
          kind: 'system_notice',
          id: `${segmentTag}_err${noticeCounter++}`,
          variant: 'error',
          text: evt.error,
          // OC-11 透传分类信息 —— SystemNotice 据此渲染 retry / open-settings 按钮
          ...(evt.action !== undefined ? { action: evt.action } : {}),
          ...(evt.retriable !== undefined ? { retriable: evt.retriable } : {}),
          // OC-23 retry-after 倒计时；retryAvailableAt 已经是 main 端 stamp 的绝对
          // 时间戳，直接透传，不在 selector 里重 stamp 防漂移 (review HIGH-2)
          ...(evt.retryAvailableAt !== undefined ? { retryAvailableAt: evt.retryAvailableAt } : {}),
        });
        break;
      }
    }
  }

  // 段末如果还有 buffered text（理论上 session_complete 之前应该 flush 了，但防御性）
  flushTextBubble();
}

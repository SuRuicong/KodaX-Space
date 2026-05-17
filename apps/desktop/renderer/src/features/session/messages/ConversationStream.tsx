// ConversationStream —— 主区的对话编排。
//
// 数据来源：useAppStore 的 events + userMessages（按当前 sessionId 取）
// 派生：composeMessages selector 把它们编织成 ConversationMessage[]
// 渲染：根据 kind 分发到 UserBubble / AssistantBubble / ToolCallCard / SystemNotice
//
// 滚动行为：
//   - 新消息到达时：如果用户已经滚到底部，自动跟进；否则不打扰
//   - "跳回底部" 浮动按钮：在用户向上滚 > 100px 时出现

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store/appStore.js';
import { composeMessages } from '../composeMessages.js';
import { AssistantBubble, SystemNotice, ToolCallCard, UserBubble } from './bubbles.js';

interface ConversationStreamProps {
  readonly sessionId: string;
}

export function ConversationStream({ sessionId }: ConversationStreamProps): JSX.Element {
  const events = useAppStore((s) => s.eventsBySession[sessionId] ?? []);
  const userMessages = useAppStore((s) => s.userMessagesBySession[sessionId] ?? []);

  const messages = useMemo(() => composeMessages({ events, userMessages }), [events, userMessages]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // 滚动检测：用户离底 > 100px 就显示"跳回底部"
  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 32;
    wasAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && distanceFromBottom > 100);
  }

  // 新消息到达：如果之前在底部，跟进；否则不动。
  // 用 useLayoutEffect 避开"先 paint 再滚"的闪烁。
  useLayoutEffect(() => {
    if (wasAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // 切 session 时强制滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
    }
  }, [sessionId]);

  function jumpToBottom(): void {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <div className="text-zinc-600 italic text-sm">
            Send a prompt below to start.
          </div>
        )}
        {messages.map((m) => {
          switch (m.kind) {
            case 'user':
              return <UserBubble key={m.id} content={m.content} />;
            case 'assistant_text':
              return <AssistantBubble key={m.id} text={m.text} thinking={m.thinking} />;
            case 'tool_call':
              return <ToolCallCard key={m.id} {...m} />;
            case 'system_notice':
              return <SystemNotice key={m.id} {...m} />;
          }
        })}
      </div>

      {showJumpToBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 right-4 text-xs px-2 py-1 rounded-full bg-zinc-800/90 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 shadow-lg"
        >
          ↓ Jump to bottom
        </button>
      )}
    </div>
  );
}

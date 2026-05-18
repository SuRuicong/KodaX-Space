// ConversationStreamV2 — alpha.1
//
// 跟 Claude Desktop 截图对齐的对话流：
//   - 工具调用聚合为 "Ran N commands ›" 折叠行（默认折叠，点开看每个 tool 卡）
//   - 用户气泡 / assistant markdown / system notice 复用原 bubbles
//   - 滚动跟进逻辑复用 ConversationStream v1
//
// 聚合规则：连续的 tool_call 折成一组；assistant_text / user / system_notice / iteration end 都打断聚合。
// 一组内 N >= 1 时显示 "Ran N commands ›"（N=1 时仍折叠，统一形态）。
// 点击聚合行展开 = 显示组里每个 tool 的细节卡。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { composeMessages, type ConversationMessage } from '../features/session/composeMessages.js';
import {
  AssistantBubble,
  SystemNotice,
  ToolCallCard,
  UserBubble,
} from '../features/session/messages/bubbles.js';

// 聚合后的 view-only message kind
type ToolGroupMessage = {
  kind: 'tool_group';
  id: string;
  tools: Array<
    Extract<ConversationMessage, { kind: 'tool_call' }>
  >;
};

type ViewMessage = Exclude<ConversationMessage, { kind: 'tool_call' }> | ToolGroupMessage;

function groupTools(messages: ConversationMessage[]): ViewMessage[] {
  const out: ViewMessage[] = [];
  let buffer: ToolGroupMessage['tools'] = [];

  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    out.push({
      kind: 'tool_group',
      id: `group_${buffer[0].id}_${buffer.length}`,
      tools: buffer,
    });
    buffer = [];
  };

  for (const m of messages) {
    if (m.kind === 'tool_call') {
      buffer.push(m);
    } else {
      flushBuffer();
      out.push(m);
    }
  }
  flushBuffer();
  return out;
}

export function ConversationStreamV2(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const events = useAppStore((s) =>
    currentSessionId ? s.eventsBySession[currentSessionId] ?? [] : [],
  );
  const userMessages = useAppStore((s) =>
    currentSessionId ? s.userMessagesBySession[currentSessionId] ?? [] : [],
  );

  const messages = useMemo(() => composeMessages({ events, userMessages }), [events, userMessages]);
  const viewMessages = useMemo(() => groupTools(messages), [messages]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // 每个 tool_group 的展开状态；默认折叠
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 32;
    wasAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && distanceFromBottom > 100);
  }

  useLayoutEffect(() => {
    if (wasAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [viewMessages.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setExpanded(new Set());
    }
  }, [currentSessionId]);

  function jumpToBottom(): void {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }

  function toggleGroup(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!currentSessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 text-sm gap-2">
        <span className="text-2xl" aria-hidden>✦</span>
        <span>What's up next?</span>
        <span className="text-xs text-zinc-700">
          Pick a session in the left sidebar, or open a folder to start.
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto px-4 py-3 space-y-3"
      >
        {viewMessages.length === 0 && (
          <div className="text-zinc-600 italic text-sm">
            Send a prompt below to start.
          </div>
        )}
        {viewMessages.map((m) => {
          switch (m.kind) {
            case 'user':
              return <UserBubble key={m.id} content={m.content} />;
            case 'assistant_text':
              return <AssistantBubble key={m.id} text={m.text} thinking={m.thinking} />;
            case 'system_notice':
              return <SystemNotice key={m.id} {...m} />;
            case 'tool_group':
              return (
                <ToolGroup
                  key={m.id}
                  group={m}
                  expanded={expanded.has(m.id)}
                  onToggle={() => toggleGroup(m.id)}
                />
              );
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

interface ToolGroupProps {
  group: ToolGroupMessage;
  expanded: boolean;
  onToggle: () => void;
}

function ToolGroup({ group, expanded, onToggle }: ToolGroupProps): JSX.Element {
  const n = group.tools.length;
  const allDone = group.tools.every((t) => t.status === 'done');
  const label = n === 1 ? 'Ran 1 command' : `Ran ${n} commands`;
  // 运行中的工具名预览
  const running = group.tools.find((t) => t.status === 'running');
  const runningHint = running ? ` · running ${running.toolName}…` : '';

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 font-mono"
      >
        <span aria-hidden className="text-zinc-600">{expanded ? '▾' : '▸'}</span>
        <span>{label}</span>
        {!allDone && <span className="text-amber-500">{runningHint}</span>}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 space-y-2 border-l border-zinc-900 pl-3">
          {group.tools.map((t) => (
            <ToolCallCard key={t.id} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}

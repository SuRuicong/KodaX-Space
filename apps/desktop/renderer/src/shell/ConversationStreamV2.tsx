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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '@kodax-space/space-ipc-schema';
import { useAppStore, type UserMessage } from '../store/appStore.js';
import { composeMessages, type ConversationMessage } from '../features/session/composeMessages.js';

// **稳定空数组**：useAppStore selector 里返回 `?? []` literal 会每次 render 创建新引用，
// zustand 默认 Object.is 比对触发 subscribe re-render → re-eval selector → 又新 [] → 无限循环
// (React error #185)。module-level const 让"空"case 复用同一引用。
const EMPTY_EVENTS: readonly SessionEvent[] = [];
const EMPTY_USER_MESSAGES: readonly UserMessage[] = [];
import {
  AssistantBubble,
  SystemNotice,
  ToolCallCard,
  UserBubble,
} from '../features/session/messages/bubbles.js';
import { WelcomeDashboard } from './WelcomeDashboard.js';

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
    currentSessionId ? s.eventsBySession[currentSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const userMessages = useAppStore((s) =>
    currentSessionId ? s.userMessagesBySession[currentSessionId] ?? EMPTY_USER_MESSAGES : EMPTY_USER_MESSAGES,
  );
  const transcriptFontSize = useAppStore((s) => s.transcriptFontSize);
  // 字号映射 — TranscriptViewMenu 的 sm / base / lg → Tailwind class
  const fontClass = transcriptFontSize === 'sm' ? 'text-xs' : transcriptFontSize === 'lg' ? 'text-base' : 'text-sm';

  const messages = useMemo(() => composeMessages({ events, userMessages }), [events, userMessages]);
  const viewMessages = useMemo(() => groupTools(messages), [messages]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // 每个 tool_group 的展开状态；默认折叠
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // P4a: Ctrl+F 全 transcript 搜索 — Electron 自带 find-in-page 不接 renderer 上下文，
  // 自己实现"按消息文本子串匹配 + ring 高亮 + ↑↓ 导航"。
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 全局 Ctrl+F 打开搜索框（焦点不在 input 也行）。BottomBar textarea 上 Ctrl+F
  // 默认就 no-op（Electron BrowserWindow 没有 native find），window 层 preventDefault 即可。
  // Esc 关闭并清空 query。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        // focus 落到搜索框（下一帧，等 input 挂载）
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // 计算匹配的 message id 列表（按 viewMessages 顺序），用于 ring 高亮 + nav。
  // 大小写不敏感；空 query → 空数组。
  const matchIds = useMemo<readonly string[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const ids: string[] = [];
    for (const m of viewMessages) {
      let txt = '';
      switch (m.kind) {
        case 'user':
          txt = m.content;
          break;
        case 'assistant_text':
          txt = m.text + (m.thinking ?? '');
          break;
        case 'system_notice':
          txt = m.text;
          break;
        case 'tool_group':
          txt = m.tools
            .map((t) => `${t.toolName} ${JSON.stringify(t.input ?? {})} ${t.result ?? ''}`)
            .join(' ');
          break;
      }
      if (txt.toLowerCase().includes(q)) ids.push(m.id);
    }
    return ids;
  }, [searchQuery, viewMessages]);

  // query 变化时重置当前位置
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [searchQuery]);

  // 当前匹配滚到中间
  useEffect(() => {
    if (matchIds.length === 0) return;
    const id = matchIds[Math.min(currentMatchIdx, matchIds.length - 1)];
    const el = scrollRef.current?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentMatchIdx, matchIds]);

  function nextMatch(): void {
    if (matchIds.length === 0) return;
    setCurrentMatchIdx((i) => (i + 1) % matchIds.length);
  }
  function prevMatch(): void {
    if (matchIds.length === 0) return;
    setCurrentMatchIdx((i) => (i - 1 + matchIds.length) % matchIds.length);
  }
  function closeSearch(): void {
    setSearchOpen(false);
    setSearchQuery('');
  }

  const currentMatchId = matchIds[Math.min(currentMatchIdx, matchIds.length - 1)];
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 32;
    wasAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && distanceFromBottom > 100);
  }

  // ResizeObserver 是真正的 sticky-bottom 实现：
  // 流式 assistant_chunk 来时 message length 不变（在同一 bubble 上累积 text），
  // 之前用 useLayoutEffect([viewMessages.length]) 不触发滚动。
  //
  // 必须 observe 一个**包裹所有内容的 inner wrapper**——之前 observe firstElementChild
  // (= 第一条 message) 在新消息追加时其高度根本不变 → observer 不触发 → spinner 看着
  // 像没追底。contentRef 指向 wrapper，它的高度=所有消息累加，无论是 list 长度变化还是
  // 单 bubble 文字累积都会触发。
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (wasAtBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [currentSessionId]);

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
    return <WelcomeDashboard />;
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`h-full overflow-auto px-4 py-3 ${fontClass}`}
      >
        <div ref={contentRef} className="space-y-3">
        {viewMessages.length === 0 && (
          <div className="text-zinc-600 italic text-sm">
            Send a prompt below to start.
          </div>
        )}
        {viewMessages.map((m) => {
          const isMatch = matchSet.has(m.id);
          const isCurrent = currentMatchId === m.id;
          const ringClass = isCurrent
            ? 'ring-2 ring-amber-500/80 rounded-md'
            : isMatch
            ? 'ring-1 ring-amber-500/40 rounded-md'
            : '';
          let inner: JSX.Element;
          switch (m.kind) {
            case 'user':
              inner = <UserBubble content={m.content} sentAt={m.sentAt} />;
              break;
            case 'assistant_text':
              inner = <AssistantBubble text={m.text} thinking={m.thinking} sentAt={m.sentAt} />;
              break;
            case 'system_notice':
              inner = <SystemNotice {...m} />;
              break;
            case 'tool_group':
              inner = (
                <ToolGroup
                  group={m}
                  expanded={expanded.has(m.id)}
                  onToggle={() => toggleGroup(m.id)}
                />
              );
              break;
          }
          return (
            <div key={m.id} data-msg-id={m.id} className={ringClass}>
              {inner}
            </div>
          );
        })}
        </div>
      </div>

      {/* P4a 搜索框 — 右上角浮窗 */}
      {searchOpen && (
        <div className="absolute top-2 right-4 z-30 flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded shadow-xl px-2 py-1">
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) prevMatch();
                else nextMatch();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Find in transcript…"
            className="bg-transparent text-xs outline-none w-44 text-zinc-200 placeholder:text-zinc-500"
          />
          <span className="text-[10px] text-zinc-400 font-mono w-12 text-right select-none">
            {searchQuery
              ? matchIds.length === 0
                ? '0/0'
                : `${currentMatchIdx + 1}/${matchIds.length}`
              : ''}
          </span>
          <button
            type="button"
            onClick={prevMatch}
            disabled={matchIds.length === 0}
            className="text-zinc-400 hover:text-zinc-100 px-1 disabled:opacity-30"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={nextMatch}
            disabled={matchIds.length === 0}
            className="text-zinc-400 hover:text-zinc-100 px-1 disabled:opacity-30"
            title="Next match (Enter)"
            aria-label="Next match"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="text-zinc-400 hover:text-zinc-100 px-1"
            title="Close (Esc)"
            aria-label="Close search"
          >
            ✕
          </button>
        </div>
      )}

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

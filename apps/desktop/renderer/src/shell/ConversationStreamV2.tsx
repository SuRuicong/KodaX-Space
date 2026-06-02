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

// 聚合后的 view-only message kind —— 两层折叠对齐 Claude Desktop "Ran 6 commands ⌄":
//
//   ▸ Ran 6 commands · 12s              ← 外层 cluster (此处折叠 = 默认)
//     ▸ List workspaces and docs        ← 内层 sub-cluster (一个 LLM step 的 N 个工具)
//       [individual ToolCallCard]       ← 工具细节 (再折一次)
//     ▸ Read more README + FEATURE_LIST
//     ...
//
// Sub-cluster 切分边界 = 每个 LLM step (assistant_text 段之间)。每个 step 通常是
// "thinking → 决定调几个 tool"，所以 step 内 0..N 个 tool_call 形成一个 sub-cluster，
// title 取 step 前 assistant_text 的首句 (preceding `assistant_text.text` 或 `thinking`)。
type ToolCallMsg = Extract<ConversationMessage, { kind: 'tool_call' }>;
type SubCluster = {
  id: string;
  title: string;
  tools: ToolCallMsg[];
};
type ToolClusterMessage = {
  kind: 'tool_cluster';
  id: string;
  subClusters: SubCluster[];
  totalTools: number;
};

/**
 * Thinking-only 视图节点 —— 对齐 VSCode Claude Code 的 "Thought for Xs" 折叠行。
 * 之前 thinking 跟 text 被绑在同一个 assistant_text 上，groupTools 把后跟 tools 的整条
 * 消息吸进 sub-cluster header 只剩 title，thinking 内容丢失。现在 groupTools 把
 * thinking 拆出来在 cluster 前单独出一条折叠记录。
 */
type ThinkingMessage = {
  kind: 'thinking';
  id: string;
  thinking: string;
};

type ViewMessage =
  | Exclude<ConversationMessage, { kind: 'tool_call' }>
  | ToolClusterMessage
  | ThinkingMessage;

/**
 * 从一段文本里取首句作为 sub-cluster 标题。
 * - 去掉首尾空白
 * - 在 '. ! ? 。！？\n' 切第一个出现点
 * - 限到 80 字符
 */
function firstSentence(text: string | undefined, maxLen = 80): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^[^.!?。！？\n]{1,200}([.!?。！？]|$)/);
  const sentence = (match?.[0] ?? trimmed).replace(/[.!?。！？]\s*$/, '').trim();
  if (sentence.length === 0) return null;
  return sentence.length > maxLen ? sentence.slice(0, maxLen - 1) + '…' : sentence;
}

/**
 * Fallback：assistant 没说话也没 thinking 时，按 tool 名汇总 "Ran 3 reads + 1 grep"。
 */
function summarizeTools(tools: readonly ToolCallMsg[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.toolName, (counts.get(t.toolName) ?? 0) + 1);
  const parts = [...counts.entries()].map(
    ([name, n]) => (n > 1 ? `${n} ${name}s` : `1 ${name}`),
  );
  return `Ran ${parts.join(' + ')}`;
}

function groupTools(messages: ConversationMessage[]): ViewMessage[] {
  const out: ViewMessage[] = [];
  let pendingCluster: SubCluster[] = [];
  let clusterCounter = 0;

  const flushCluster = (): void => {
    if (pendingCluster.length === 0) return;
    const totalTools = pendingCluster.reduce((acc, sc) => acc + sc.tools.length, 0);
    out.push({
      kind: 'tool_cluster',
      id: `cluster_${clusterCounter++}_${pendingCluster[0].id}`,
      subClusters: pendingCluster,
      totalTools,
    });
    pendingCluster = [];
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (m.kind === 'user' || m.kind === 'system_notice') {
      flushCluster();
      out.push(m);
      continue;
    }

    if (m.kind === 'assistant_text') {
      // 前看：紧跟的 tool_call 序列归入本 step 的 sub-cluster；
      // 若不跟 tool 则当成 final answer 独立渲染。
      const tools: ToolCallMsg[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].kind === 'tool_call') {
        tools.push(messages[j] as ToolCallMsg);
        j++;
      }
      if (tools.length > 0) {
        // v0.1.4 修复：thinking 之前跟 text 一起被 sub-cluster 吸收只剩 title，
        // 内容彻底丢失。现在把 thinking 拆出来 flush 在 cluster 前 —— 单独一条
        // 可折叠记录（对齐 VSCode Claude Code "Thought for Xs" 行）。
        if (m.thinking && m.thinking.length > 0) {
          flushCluster();
          out.push({ kind: 'thinking', id: `${m.id}_thinking`, thinking: m.thinking });
        }
        const title =
          firstSentence(m.text) ??
          firstSentence(m.thinking) ??
          summarizeTools(tools);
        pendingCluster.push({ id: m.id, title, tools });
        i = j - 1; // 跳过 consumed tool_calls (for loop ++ 再 +1 到 j)
      } else {
        flushCluster();
        out.push(m);
      }
      continue;
    }

    if (m.kind === 'tool_call') {
      // 没前置 assistant_text 的 tool (罕见，首轮 thinking 直接出工具)：
      // 单独成一个 sub-cluster，标题用 tool 汇总。
      pendingCluster.push({ id: m.id, title: summarizeTools([m]), tools: [m] });
    }
  }
  flushCluster();
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
  // 用来判断 "is this session loading history?" — persisted session 在 SDK summary
  // 有 msgCount > 0,而 in-memory buffer 还是空的 → history.IPC 在 flight,显示骨架更友好
  const currentSessionMsgCount = useAppStore((s) => {
    const sid = s.currentSessionId;
    if (!sid) return 0;
    return s.sessions.find((x) => x.sessionId === sid)?.msgCount ?? 0;
  });
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
        case 'tool_cluster':
          txt = m.subClusters
            .flatMap((sc) => [
              sc.title,
              ...sc.tools.map((t) => `${t.toolName} ${JSON.stringify(t.input ?? {})} ${t.result ?? ''}`),
            ])
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

  // OC-18 markAuto guard：区分**程序滚动**和**用户滚动**。
  //
  // 之前的 bug 时序：
  //   1. ResizeObserver fires：内容增长 → 程序设 scrollTop = scrollHeight (跳到底)
  //   2. 几乎同时 ResizeObserver fires 又一次：又长了几像素 → 再设 scrollTop
  //   3. (1) 的 scroll 事件异步派发，此时已经到 (2) 状态，distanceFromBottom > 32
  //   4. handleScroll 误以为用户上滚了 → wasAtBottomRef.current = false
  //   5. 后续 observer 看到 false → 停止 follow → 屏幕卡在中间
  //
  // 守卫：程序滚动前打 timestamp，handleScroll 在 PROGRAMMATIC_SCROLL_GUARD_MS 内跳过更新。
  // 用户真的上滚时无 timestamp / 已过期 → 正常处理。
  //
  // 时钟源：performance.now() 而非 Date.now() —— 后者随系统时钟可跳变 (NTP / DST)，
  //   监测短时间间隔 (<1s) 必须用单调 monotonic clock.
  // 时长：400ms 覆盖 jumpToBottom 的 `behavior:'smooth'` 动画 (~300ms) + 余量；
  //   ResizeObserver 阶段一般 16-50ms 也包在内。
  const lastProgrammaticScrollRef = useRef<number>(0);
  const PROGRAMMATIC_SCROLL_GUARD_MS = 400;

  function markProgrammaticScroll(): void {
    lastProgrammaticScrollRef.current = performance.now();
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    // 守卫期内的 scroll 事件来自 ResizeObserver / smooth scroll 自己的 scrollTop 赋值，
    // 不视为用户上滚
    if (performance.now() - lastProgrammaticScrollRef.current < PROGRAMMATIC_SCROLL_GUARD_MS) return;
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
        markProgrammaticScroll();
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [currentSessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      markProgrammaticScroll();
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      wasAtBottomRef.current = true;
      setShowJumpToBottom(false);
      setExpanded(new Set());
    }
  }, [currentSessionId]);

  function jumpToBottom(): void {
    if (!scrollRef.current) return;
    markProgrammaticScroll();
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
    <div className="relative flex-1 overflow-hidden" data-testid="conversation-stream">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`h-full overflow-auto px-8 py-5 ${fontClass}`}
      >
        {/* 左右只留几个字符的 padding，不限宽 —— 用户反馈 max-w-3xl 在宽屏留太多空白。
            左侧时间线 rail = 绝对定位竖线 + 每条消息圆点 marker；`pl-6` 给 marker 让位。*/}
        <div ref={contentRef} className="relative pl-6">
          {/* timeline 竖线 —— 仅 viewMessages 长度 > 0 时画，避免空状态出现孤立竖线 */}
          {viewMessages.length > 0 && (
            <div
              className="absolute left-[7px] top-2 bottom-2 w-px bg-border-default/70 dark:bg-zinc-800"
              aria-hidden
            />
          )}
          <div className="space-y-4">
        {viewMessages.length === 0 && (
          currentSessionMsgCount > 0 ? (
            // 有 SDK summary msgCount 但 buffer 空 → history IPC 正在 flight,显示骨架
            // 比 "Send a prompt to start" 更准确,也免去用户盯着空白屏幕等几百毫秒
            <HistoryRestoreSkeleton />
          ) : (
            <div className="text-zinc-600 italic text-sm">
              Send a prompt below to start.
            </div>
          )
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
          let markerTone: MarkerTone = 'assistant';
          switch (m.kind) {
            case 'user':
              inner = <UserBubble content={m.content} sentAt={m.sentAt} />;
              markerTone = 'user';
              break;
            case 'assistant_text':
              inner = <AssistantBubble text={m.text} thinking={m.thinking} sentAt={m.sentAt} />;
              markerTone = 'assistant';
              break;
            case 'system_notice':
              inner = <SystemNotice {...m} />;
              markerTone = 'system';
              break;
            case 'tool_cluster':
              inner = (
                <ToolCluster
                  cluster={m}
                  expanded={expanded.has(m.id)}
                  onToggle={() => toggleGroup(m.id)}
                  expandedSubs={expanded}
                  toggleSub={toggleGroup}
                />
              );
              markerTone = 'tool';
              break;
            case 'thinking':
              inner = (
                <ThinkingBlock
                  thinking={m.thinking}
                  expanded={expanded.has(m.id)}
                  onToggle={() => toggleGroup(m.id)}
                />
              );
              markerTone = 'thinking';
              break;
          }
          return (
            <div key={m.id} data-msg-id={m.id} className={`relative ${ringClass}`}>
              <TimelineMarker tone={markerTone} />
              {inner}
            </div>
          );
        })}
          </div>
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

// Timeline rail marker —— absolute 定位到时间线竖线上，配色按消息 kind 区分
// 让用户一眼能扫出"哪些是我说的 / 模型说的 / 系统通知 / 工具调用 / 思考"。
// 直径 9px，与 rail (1px wide @ left:7px) 居中对齐 = marker.left = 3px。
type MarkerTone = 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
const MARKER_TONE_CLASS: Record<MarkerTone, string> = {
  user: 'bg-sky-500 dark:bg-sky-400',
  assistant: 'bg-emerald-500 dark:bg-emerald-400',
  system: 'bg-amber-500 dark:bg-amber-400',
  tool: 'bg-zinc-400 dark:bg-zinc-500',
  thinking: 'bg-purple-500 dark:bg-purple-400',
};
function TimelineMarker({ tone }: { tone: MarkerTone }): JSX.Element {
  return (
    <span
      aria-hidden
      className={`absolute left-[-22px] top-[10px] w-[9px] h-[9px] rounded-full ring-2 ring-surface ${MARKER_TONE_CLASS[tone]}`}
    />
  );
}

/**
 * ThinkingBlock — 对齐 VSCode Claude Code "Thought for Xs" 折叠行。
 * 折叠态 = 紫色一行 `▸ Thinking · ~N tokens`，展开态 = 多行 pre-wrap 文本。
 * approxTokens 复用 bubbles.tsx 的算法（4 chars ≈ 1 token），但这里 inline 实现避免循环依赖。
 */
function ThinkingBlock({
  thinking,
  expanded,
  onToggle,
}: {
  thinking: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const tokens = Math.max(1, Math.round(thinking.length / 4));
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={[
          'text-[11px] font-mono flex items-center gap-1.5',
          'dark:text-purple-400 dark:hover:text-purple-300',
          'text-purple-700 hover:text-purple-900',
        ].join(' ')}
        aria-expanded={expanded}
      >
        <span aria-hidden className="dark:text-zinc-600 text-zinc-400">
          {expanded ? '⌄' : '›'}
        </span>
        <span>Thinking · ~{tokens} tokens</span>
      </button>
      {expanded && (
        <div
          className={[
            'mt-1.5 ml-3 pl-2 border-l text-xs whitespace-pre-wrap',
            'dark:border-purple-900/60 dark:text-purple-300/80',
            'border-purple-200 text-purple-800',
          ].join(' ')}
        >
          {thinking}
        </div>
      )}
    </div>
  );
}

interface ToolClusterProps {
  cluster: ToolClusterMessage;
  expanded: boolean;
  onToggle: () => void;
  expandedSubs: Set<string>;
  toggleSub: (id: string) => void;
}

/**
 * 两层折叠 cluster：
 *   外层 "Ran 6 commands · 12s ⌄" → 展开后看到 6 个 sub-cluster
 *   每个 sub-cluster "▸ List workspaces and docs" → 展开后看到具体 ToolCallCard
 * 状态全用 expanded Set<id> 管：外层 id 是 cluster.id，内层 id 是 sub.id。
 */
function ToolCluster({
  cluster,
  expanded,
  onToggle,
  expandedSubs,
  toggleSub,
}: ToolClusterProps): JSX.Element {
  const allTools = cluster.subClusters.flatMap((sc) => sc.tools);
  const allDone = allTools.every((t) => t.status === 'done');
  const running = allTools.find((t) => t.status === 'running');
  const label =
    cluster.totalTools === 1 ? 'Ran 1 command' : `Ran ${cluster.totalTools} commands`;
  const runningHint = running ? ` · running ${running.toolName}…` : '';

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="dark:text-zinc-400 dark:hover:text-zinc-200 text-zinc-600 hover:text-zinc-900 flex items-center gap-1.5"
      >
        <span aria-hidden className="dark:text-zinc-600 text-zinc-400">
          {expanded ? '⌄' : '›'}
        </span>
        <span>{label}</span>
        {!allDone && <span className="text-amber-500">{runningHint}</span>}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-3 space-y-1.5 border-l dark:border-zinc-800 border-zinc-200 pl-3">
          {cluster.subClusters.map((sc) => {
            const subOpen = expandedSubs.has(sc.id);
            const subAllDone = sc.tools.every((t) => t.status === 'done');
            const subRunning = sc.tools.find((t) => t.status === 'running');
            return (
              <div key={sc.id}>
                <button
                  type="button"
                  onClick={() => toggleSub(sc.id)}
                  className="w-full text-left flex items-start gap-1.5 dark:text-zinc-300 dark:hover:text-zinc-100 text-zinc-700 hover:text-zinc-900"
                >
                  <span
                    aria-hidden
                    className="dark:text-zinc-600 text-zinc-400 flex-shrink-0 mt-px"
                  >
                    {subOpen ? '⌄' : '›'}
                  </span>
                  <span className="truncate">{sc.title}</span>
                  {!subAllDone && subRunning && (
                    <span className="text-amber-500 text-[10px] flex-shrink-0">
                      · {subRunning.toolName}…
                    </span>
                  )}
                </button>
                {subOpen && (
                  <div className="mt-1 ml-3 space-y-2">
                    {sc.tools.map((t) => (
                      <ToolCallCard key={t.id} {...t} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 历史会话加载骨架 — 点旧 session 后 jsonl IPC 在 flight 时显示 (~50-200ms)。
// 一组 user/assistant 气泡 shimmer,让用户知道"正在加载"而不是"空白会话"。
// 用 animate-pulse + 几条灰度 bar 模拟消息形态,无额外 CSS keyframe。
function HistoryRestoreSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading conversation history">
      {/* user 气泡 (右对齐) */}
      <div className="flex justify-end">
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2 max-w-[60%]">
          <div className="h-3 w-48 bg-zinc-700/60 rounded" />
        </div>
      </div>
      {/* assistant 气泡 (左对齐,多行) */}
      <div className="space-y-2">
        <div className="h-3 w-3/4 bg-zinc-800/60 rounded" />
        <div className="h-3 w-2/3 bg-zinc-800/60 rounded" />
        <div className="h-3 w-1/2 bg-zinc-800/60 rounded" />
      </div>
      {/* user 气泡 #2 */}
      <div className="flex justify-end">
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2 max-w-[40%]">
          <div className="h-3 w-32 bg-zinc-700/60 rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-5/6 bg-zinc-800/60 rounded" />
        <div className="h-3 w-2/3 bg-zinc-800/60 rounded" />
      </div>
      <div className="pt-2 text-[10px] text-zinc-600 italic">Loading conversation…</div>
    </div>
  );
}

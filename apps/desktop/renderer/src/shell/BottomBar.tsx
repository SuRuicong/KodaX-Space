// BottomBar — F011-revised
//
// 三层结构（自下而上）：
//   1. Footer-row：Mode/Gateway 左下，Model+Effort 右下（弹出选择）
//   2. InputBox：textarea + Send/Cancel
//   3. ChipBar：Local · Project · branch · worktree-flag
//
// 取代旧 EventStream 底部 InputBox 区。

import { useEffect, useRef, useState } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { QueueIndicator } from './QueueIndicator.js';
import { AttachMenu } from './AttachMenu.js';
import { AgentPicker } from './AgentPicker.js';
import { AtPathPopover } from './AtPathPopover.js';
import { SlashCommandPopover, type SlashPickerItem } from './SlashCommandPopover.js';
import { resolveSessionCreateInputs } from './createSession.js';
import { useIsStreaming } from './ActivitySpinner.js';
import { AgentModeSelector } from './AgentModeSelector.js';
import { AmaWorkStrip } from './AmaWorkStrip.js';
import { BackgroundTaskBar } from './BackgroundTaskBar.js';
import { StashNotice } from './StashNotice.js';
import { RetryBanner } from './RetryBanner.js';
import { NotificationsSurface } from './NotificationsSurface.js';
import { pushToast } from '../store/toastStore.js';

/**
 * F031 helper：按空白切 args，保留双引号包裹的整段。
 * 上限 20 与 slashExecChannel 的 z.array(...).max(20) 一致——超出后停切，
 * 避免恶意粘贴在 renderer 端就预分配巨大数组。
 */
const SLASH_ARGS_MAX = 20;

// 稳定空引用，避免 selector 返 `?? []` literal 每渲染新引用触发 zustand re-render loop
const EMPTY_INPUT_HISTORY: readonly string[] = [];

/**
 * 从首条 user prompt 派生 session title。
 * alpha.1 用前 50 字符截断 + 去除换行；v0.1.x 可升级到调 Haiku 类小模型总结
 * (对照 c:\Works\claudecode\src\utils\sessionTitle.ts 的 generateSessionTitle)。
 *
 * 不处理 slash 命令开头 — `/help` `/clear` 这类不该被当 session topic。
 */
const TITLE_MAX_CHARS = 50;
function deriveTitle(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;
  // 取前 N 字符，单行
  const oneLine = trimmed.replace(/\s+/g, ' ');
  const sliced = oneLine.length > TITLE_MAX_CHARS
    ? oneLine.slice(0, TITLE_MAX_CHARS).trimEnd() + '…'
    : oneLine;
  return sliced;
}
function tokenizeArgs(rest: string): string[] {
  const result: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push(m[1] ?? m[2] ?? '');
    if (result.length >= SLASH_ARGS_MAX) break;
  }
  return result;
}

export function BottomBar(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const rollbackLastUserMessage = useAppStore((s) => s.rollbackLastUserMessage);
  const resetSessionMessages = useAppStore((s) => s.resetSessionMessages);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setPendingSend = useAppStore((s) => s.setPendingSend);
  const appendInputHistory = useAppStore((s) => s.appendInputHistory);
  const inputHistory = useAppStore((s) =>
    currentSessionId ? s.inputHistoryBySession[currentSessionId] ?? EMPTY_INPUT_HISTORY : EMPTY_INPUT_HISTORY,
  );
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** P0c: ↑/↓ 翻历史时的指针：-1 = 未浏览（输入框是用户当前 draft），0..n-1 = 看历史第 i 条。*/
  const [historyIdx, setHistoryIdx] = useState(-1);
  /** 在用户首次按 ↑ 之前，缓存 draft，回到 idx=-1 时还原。 */
  const draftRef = useRef<string>('');

  /** caret 实时位置 (跟 prompt 一起喂给 AtPathPopover 判断是否在 @token 里)。 */
  const [caret, setCaret] = useState(0);
  /** AtPathPopover 注册的 keydown 拦截器; 优先消费 Tab/Enter/↑↓/Esc 用于选项 */
  const atPathKeyHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  /** AgentPicker 用: 将 text 插入 textarea 当前 caret 位置 (替换 selection 区间)。 */
  function insertAtCaret(text: string): void {
    const ta = textareaRef.current;
    if (!ta) {
      setPrompt((p) => p + text);
      return;
    }
    const start = ta.selectionStart ?? prompt.length;
    const end = ta.selectionEnd ?? prompt.length;
    const next = prompt.slice(0, start) + text + prompt.slice(end);
    setPrompt(next);
    // 还原焦点 + 把 caret 移到插入位置之后 (下一帧 textarea 已经反映新值)。
    // rAF 期间组件可能 unmount/remount (路由切换等),旧 `ta` 变 detached node。
    // 重新读 ref 拿当前真实节点 (审查 M4)。
    const newPos = start + text.length;
    requestAnimationFrame(() => {
      const live = textareaRef.current;
      if (!live) return;
      live.focus();
      try {
        live.setSelectionRange(newPos, newPos);
      } catch {
        /* detached / readonly textarea — no-op */
      }
    });
  }

  /**
   * Auto-grow textarea：min 2 行（rows={2} 提供基线），max 12 行后开始内滚。
   * 同 Claude Desktop / ChatGPT 同款行为——粘大段 prompt 时能撑开看到全文。
   * 缓存 maxHeight 在 useRef 里，避免每次 keystroke 都读 computed style。
   */
  const maxHeightRef = useRef<number | null>(null);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // 首次（或 line-height 变化时）算 max：12 行 * line-height
    if (maxHeightRef.current === null) {
      const cs = window.getComputedStyle(ta);
      // line-height: 'normal' fallback 到 fontSize * 1.4
      let lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh)) {
        const fs = parseFloat(cs.fontSize) || 14;
        lh = fs * 1.4;
      }
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      maxHeightRef.current = Math.round(lh * 12 + padTop + padBottom);
    }
    // 重置 → 读 scrollHeight → 取 min(scroll, max)。先 'auto' 让浏览器自然
    // 收缩到内容尺寸，再读 scrollHeight 才是当前真实需要的高度。
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, maxHeightRef.current);
    ta.style.height = `${next}px`;
    // overflow：超过 max 时露出滚动条，否则隐藏避免抖动
    ta.style.overflowY = ta.scrollHeight > maxHeightRef.current ? 'auto' : 'hidden';
  }, [prompt]);

  // OC-11: SystemNotice "Retry" 按钮派发 CustomEvent → 聚焦 textarea，让用户立即按 Enter 重发。
  // 目前不主动还填 prompt（避免覆盖正在输入的草稿）；用户可按 ↑ 调取历史最后一条。
  useEffect(() => {
    const onFocus = (): void => textareaRef.current?.focus();
    window.addEventListener('kodax-space.focus-textarea', onFocus);
    return () => window.removeEventListener('kodax-space.focus-textarea', onFocus);
  }, []);

  /**
   * 没 session 时第一条 prompt 触发自动建 session。
   * project 必须先打开（projectRoot 是 session.create 必填）。
   * 返回新 sessionId 或 null（失败：err 已 setErr）。
   */
  async function ensureSession(): Promise<string | null> {
    if (currentSessionId) return currentSessionId;
    if (!window.kodaxSpace) return null;
    if (!currentProjectPath) {
      setErr('Open a folder first — Ctrl+O.');
      return null;
    }
    const { provider, reasoningMode, permissionMode, agentMode } = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode,
      pendingAgentMode,
    });
    const result = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider,
      reasoningMode,
      permissionMode,
      agentMode,
    });
    if (!result.ok) {
      setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'create failed'}`);
      return null;
    }
    const stub: SessionMeta = {
      sessionId: result.data.sessionId,
      projectRoot: currentProjectPath,
      provider,
      reasoningMode,
      permissionMode,
      autoModeEngine: 'llm',
      agentMode,
      title: undefined,
      createdAt: result.data.createdAt,
      lastActivityAt: result.data.createdAt,
    };
    upsertSession(stub);
    setCurrentSession(stub.sessionId);
    // 仅消费 provider 的 pending（provider 有独立 defaultProviderId 兜底）；mode 类
    // pending（permission / reasoning / agent）现在等同"用户首选"，持久化在 LS 留下次默认
    setPendingProviderId(null);
    // 刷新权威列表（让 LeftSidebar Recents 立即看到新条目）
    const listResult = await window.kodaxSpace.invoke('session.list', {
      projectRoot: currentProjectPath,
    });
    if (listResult.ok) useAppStore.getState().setSessions(listResult.data.sessions);
    return stub.sessionId;
  }

  /**
   * slash 模式：trim 后以 '/' 起头、且不含空白（仍在敲命令名）。
   * 用 trimmed 而非 raw 是为了让 ` /help`（前导空格、粘贴常见）也能弹补全；
   * 用 \s 而非空格能同时识别 \n \t（多行/粘贴）。
   */
  const trimmedPrompt = prompt.trimStart();
  const slashMode = trimmedPrompt.startsWith('/') && !/\s/.test(trimmedPrompt);

  /**
   * Slash 命令分两步：
   *   1) slash.exec — main 端有 builtin handler 时直接执行
   *   2) 若 main 返回 unknownCommand:true → 调 execSkill 试 skill registry
   * busy 状态在外部包裹 (execSlashOrSkill)，避免中间放掉 → 用户能并发触发新命令。
   *
   * 显式传 sessionId 而非读 currentSessionId 闭包——auto-create session 后
   * setCurrentSession 在下次 render 才生效，闭包里还是 stale null。
   */
  async function execSlashOrSkill(sessionId: string, name: string, args: string[]): Promise<void> {
    if (!window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('slash.exec', {
        sessionId,
        name,
        args,
      });
      if (!result.ok) {
        setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
        return;
      }
      const { ok, message, echo, clearStream, unknownCommand } = result.data;
      // F035: slash 找不到 → 试 skill。用 unknownCommand 字段（reviewer HIGH-3：
      // 不再字符串匹配 message）。
      if (unknownCommand) {
        await invokeSkill(sessionId, name, args);
        return;
      }
      // P1: __action__:* 内部 action 协议 — main 给到 renderer 时不 echo，由 renderer
      // 自己渲染 / 执行（clipboard / 新建 session 等）。
      if (ok && message?.startsWith('__action__:')) {
        await dispatchSlashAction(sessionId, name, args, message.slice('__action__:'.length));
        return;
      }
      if (echo && message) {
        // F031: /help /clear 等命令把 message 当 system_notice 显示
        appendUserMessage(sessionId, `/${name} ${args.join(' ')}`.trim());
      }
      if (clearStream) {
        // F031: 由 handler 显式请求清空消息流（不再 hardcode name === 'clear'）。
        resetSessionMessages(sessionId);
      }
      if (!ok && message) {
        setErr(message);
      } else if (ok && message && !echo) {
        // 静默成功命令（mode/provider）给一个一闪即逝的反馈
        setErr(null);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * P1: 处理 main 返回的 __action__:* 协议。每种 action 自己决定怎么呈现：
   *   - new-session: 清 currentSession 让 LeftSidebar 触发 New session 行为（pending 状态保留）
   *   - copy-last: 抓最近 text_delta sum，写 navigator.clipboard
   *   - show-cost / show-tree / show-history: 用 appendUserMessage 把汇总插一条 system 行
   *
   * 不接 main 的 setter（这些 action 都是 renderer-side 数据派生）。
   */
  async function dispatchSlashAction(
    sessionId: string,
    name: string,
    args: string[],
    action: string,
  ): Promise<void> {
    // 始终先 echo 命令本身，让用户在 transcript 里看见自己输入了什么
    appendUserMessage(sessionId, `/${name} ${args.join(' ')}`.trim());

    const state = useAppStore.getState();
    const events = state.eventsBySession[sessionId] ?? [];

    if (action === 'new-session') {
      // 把 currentSession 置 null，LeftSidebar 的 "+ New session" 用户自助点；
      // 这里做"清空当前"动作（避免 main 也得管 session.create 的全部 deps）
      state.setCurrentSession(null);
      return;
    }

    if (action === 'copy-last') {
      // 抓最近一段连续的 text_delta，拼成 last assistant message
      let lastText = '';
      // 倒序找到 session_complete/error 前一段或末尾的 text_delta
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.kind === 'text_delta') lastText = (ev as { text?: string }).text + lastText;
        else if (ev.kind === 'session_complete' || ev.kind === 'session_error') {
          // 跳过这条 lifecycle event 继续往前收
          continue;
        } else if (lastText.length > 0 && (ev.kind === 'tool_result' || ev.kind === 'session_start')) {
          break;
        }
      }
      if (lastText.length === 0) {
        pushToast('No assistant message to copy', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(lastText);
        pushToast(`Copied ${lastText.length} chars to clipboard`, 'success');
      } catch (err) {
        pushToast(
          `Clipboard write failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
      return;
    }

    if (action === 'show-cost') {
      // 汇总 iteration_end 里的 tokenCount 与 usage
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let lastIter = 0;
      let maxIter = 0;
      for (const ev of events) {
        if (ev.kind === 'iteration_end') {
          const e = ev as { iter?: number; maxIter?: number; tokenCount?: number; usage?: { inputTokens?: number; outputTokens?: number } };
          if (typeof e.iter === 'number') lastIter = e.iter;
          if (typeof e.maxIter === 'number') maxIter = e.maxIter;
          if (typeof e.tokenCount === 'number') totalTokens = e.tokenCount;
          if (e.usage) {
            if (typeof e.usage.inputTokens === 'number') inputTokens = e.usage.inputTokens;
            if (typeof e.usage.outputTokens === 'number') outputTokens = e.usage.outputTokens;
          }
        }
      }
      const lines = [
        `[cost] session: ${sessionId.slice(0, 12)}…`,
        `  iterations: ${lastIter}/${maxIter || '?'}`,
        `  input tokens: ${inputTokens.toLocaleString()}`,
        `  output tokens: ${outputTokens.toLocaleString()}`,
        `  total: ${totalTokens.toLocaleString()}`,
        '  (cost estimate requires per-model pricing — v0.1.7+)',
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-tree') {
      // 当前 session 沿 parentSessionId 上溯 + 同 parent 的所有 children 列出
      const all = state.sessions;
      const me = all.find((s) => s.sessionId === sessionId);
      if (!me) {
        appendUserMessage(sessionId, '[tree] session not in renderer list');
        return;
      }
      // 走 root
      let root = me;
      while (root.parentSessionId) {
        const parent = all.find((s) => s.sessionId === root.parentSessionId);
        if (!parent) break;
        root = parent;
      }
      // DFS 列出 root 及所有后代
      const lines: string[] = [`[tree] lineage from ${root.sessionId.slice(0, 12)}…`];
      const visit = (sid: string, depth: number): void => {
        const sess = all.find((s) => s.sessionId === sid);
        if (!sess) return;
        const marker = sess.sessionId === sessionId ? '◉' : '○';
        const indent = '  '.repeat(depth);
        lines.push(`${indent}${marker} ${sess.title ?? sess.sessionId.slice(0, 12)}`);
        const kids = all.filter((s) => s.parentSessionId === sid);
        for (const k of kids) visit(k.sessionId, depth + 1);
      };
      visit(root.sessionId, 0);
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-history') {
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      if (userMsgs.length === 0) {
        appendUserMessage(sessionId, '[history] no user messages yet');
        return;
      }
      const lines = [
        `[history] ${userMsgs.length} user message(s):`,
        ...userMsgs.slice(-20).map((m, i) => {
          const idx = Math.max(0, userMsgs.length - 20) + i + 1;
          const head = m.content.replace(/\s+/g, ' ').slice(0, 80);
          return `  ${idx}. ${head}${m.content.length > 80 ? '…' : ''}`;
        }),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-repointel') {
      // events buffer 倒序找最近 8 条 repointel_trace
      const traces: Array<{ kind: string; mode?: string; engine?: string; status?: string; latencyMs?: number; cacheHit?: boolean }> = [];
      for (let i = events.length - 1; i >= 0 && traces.length < 8; i--) {
        const ev = events[i];
        if (ev.kind === 'repointel_trace') {
          // event 字段在 ZodSchema 中是 nested 在 .event 里
          const e = (ev as { event?: typeof traces[number] }).event;
          if (e) traces.unshift(e);
        }
      }
      if (traces.length === 0) {
        appendUserMessage(sessionId, '[repointel] no traces yet — KodaX repo-intelligence has not emitted any events this session');
        return;
      }
      const lines = [
        `[repointel] last ${traces.length} trace(s):`,
        ...traces.map((t, i) => {
          const parts = [`${i + 1}. ${t.kind}`];
          if (t.mode) parts.push(`mode=${t.mode}`);
          if (t.engine) parts.push(`engine=${t.engine}`);
          if (t.status) parts.push(`status=${t.status}`);
          if (typeof t.latencyMs === 'number') parts.push(`${t.latencyMs}ms`);
          if (t.cacheHit) parts.push('cache=hit');
          return `  ${parts.join(' · ')}`;
        }),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-memory') {
      // v0.1.x: 直接打开 Agents popout (REPL /memory 同款 — 打开 inline editor)。
      // Popout 里可以编辑 global / project AGENTS.md (写盘走 session.agentsMd.save IPC)。
      useAppStore.getState().requestPopout('agents');
      return;
    }

    if (action === 'insert-review-template') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[review] no project / IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('project.gitDiff', { projectRoot: currentProjectPath });
      if (!r.ok) {
        appendUserMessage(sessionId, `[review] git diff failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.isGitRepo) {
        appendUserMessage(sessionId, '[review] not a git repository');
        return;
      }
      if (r.data.error !== null) {
        // git diff 命令本身失败 (timeout / spawn) — 不同于"无改动"
        appendUserMessage(sessionId, `[review] ${r.data.error}`);
        return;
      }
      if (r.data.diff.trim().length === 0) {
        appendUserMessage(sessionId, '[review] no uncommitted changes vs HEAD');
        return;
      }
      // 把模板 + diff 塞入 textarea (替换当前 prompt) — 用户审阅后按 Send
      const truncationNote = r.data.truncated ? '\n\n*(diff truncated at 64KB — full review may need narrower scope)*' : '';
      const template = [
        'Please review the following uncommitted changes vs HEAD. For each meaningful change:',
        '- Note correctness bugs or edge cases',
        '- Flag security / performance issues',
        '- Suggest concrete improvements (cite file:line)',
        'Avoid generic "consider X" — name the actual issue or skip.',
        '',
        '```diff',
        r.data.diff,
        '```',
        truncationNote,
      ].join('\n');
      setPrompt(template);
      // 焦点回 textarea 让用户能立刻按 Enter 发
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (action === 'show-status') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[status] IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('session.listRunning', undefined);
      if (!r.ok) {
        appendUserMessage(sessionId, `[status] listRunning failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const peers = r.data.peers;
      if (peers.length === 0) {
        appendUserMessage(sessionId, '[status] No other KodaX peer instances running.');
        return;
      }
      const lines = [`[status] ${peers.length} other peer instance(s):`];
      for (const p of peers) {
        const ageSec = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000));
        const ageLabel = ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : `${Math.floor(ageSec / 3600)}h`;
        const sid = p.sessionId ? p.sessionId.slice(0, 12) : '(bootstrapping)';
        lines.push(`  pid ${p.pid} · session ${sid} · ${ageLabel} ago · ${p.cwd}`);
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-doctor') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[doctor] IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('provider.list', undefined);
      if (!r.ok) {
        appendUserMessage(sessionId, `[doctor] provider.list failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const providers = r.data.providers;
      // 并发 HTTP probe 已配置的 provider (未配置的不 probe — 必然 401)
      const probeTargets = providers.filter((p) => p.configured);
      const probeResults = await Promise.all(
        probeTargets.map(async (p) => {
          if (!window.kodaxSpace) return { id: p.id, ok: false, error: 'no IPC' };
          const tr = await window.kodaxSpace.invoke('provider.test', { providerId: p.id });
          if (!tr.ok) return { id: p.id, ok: false, error: tr.error?.message ?? 'IPC error' };
          return {
            id: p.id,
            ok: tr.data.ok,
            latencyMs: tr.data.latencyMs,
            error: tr.data.error,
          };
        }),
      );
      const probeById = new Map(probeResults.map((x) => [x.id, x]));

      const lines: string[] = [`[doctor] ${providers.length} provider(s), default = ${r.data.defaultProviderId ?? '(none)'}, keychain = ${r.data.keychainBackend}`];
      for (const p of providers) {
        const isDefault = p.id === r.data.defaultProviderId ? ' ★' : '';
        const keyStatus = p.configured ? '✓ key' : '⨯ no key';
        const probe = probeById.get(p.id);
        let probeStatus = '';
        if (p.configured && probe) {
          if (probe.ok) {
            const lat = probe.latencyMs !== undefined ? ` ${probe.latencyMs}ms` : '';
            probeStatus = ` · ✓ HTTP${lat}`;
          } else {
            probeStatus = ` · ⨯ HTTP: ${probe.error ?? 'failed'}`;
          }
        }
        lines.push(`  ${p.id}${isDefault} (${p.displayName}) — ${keyStatus}${probeStatus}`);
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    // 未知 action — 兜底显示原 message
    appendUserMessage(sessionId, `[unknown action: ${action}]`);
  }

  /** 仅 popover 直接点中 slash 命令（已知 builtin、无 fallback 必要）时用。*/
  async function execSlashDirect(sessionId: string, name: string, args: string[]): Promise<void> {
    // 这层薄壳保持与原 execSlash 相同的 busy 语义但不做 skill fallback。
    // 当前实现复用 execSlashOrSkill；future 若需要细分语义可分开。
    await execSlashOrSkill(sessionId, name, args);
  }

  /**
   * F035: 执行 skill → 拿 resolvedPrompt → 走 session.send。
   * appendUserMessage 显示 "/<skill> args" 让用户在 stream 里看到调用记录。
   * Renderer 不再 echo resolvedPrompt 本身（那是 KodaX runtime 输入；显示会很啰嗦）。
   *
   * **不**管 setBusy——由调用方 (execSlashOrSkill / onSlashPick) 包 busy 状态，
   * 避免 slash→skill fallback 时 setBusy(false)→setBusy(true) 中间窗口
   * (reviewer F035 MEDIUM-1)。
   */
  async function invokeSkill(sessionId: string, name: string, args: string[]): Promise<void> {
    if (!window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('skill.invoke', {
      sessionId,
      skillName: name,
      args,
    });
    if (!result.ok) {
      setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
      return;
    }
    const { ok, resolvedPrompt, error } = result.data;
    if (!ok || resolvedPrompt === undefined) {
      setErr(error ?? `skill /${name} failed`);
      return;
    }
    // 把 "/skill args" 当一条 user message 显示
    const skillEcho = `/${name} ${args.join(' ')}`.trim();
    appendUserMessage(sessionId, skillEcho);
    // P0a: 标记 pending，让 spinner 在 IPC 期间就亮起来
    setPendingSend(sessionId, true);
    const sendResult = await window.kodaxSpace.invoke('session.send', {
      sessionId,
      prompt: resolvedPrompt,
    });
    if (!sendResult.ok) {
      setPendingSend(sessionId, false);
      // v0.1.4 B3: 失败 → 回滚刚 echo 的 user message，避免对话流挂着孤气泡
      rollbackLastUserMessage(sessionId, skillEcho);
      setErr(`${sendResult.error?.code ?? 'ERR_UNKNOWN'}: ${sendResult.error?.message ?? 'unknown error'}`);
    } else if (sendResult.data.queued) {
      pushToast('Queued — will run after the current turn finishes', 'info');
    }
  }

  async function handleSend(): Promise<void> {
    if (!window.kodaxSpace) return;
    const trimmed = prompt.trim();
    if (trimmed === '') return;
    if (trimmed.startsWith('/')) {
      const head = trimmed.slice(1);
      const spaceIdx = head.search(/\s/);
      const name = (spaceIdx === -1 ? head : head.slice(0, spaceIdx)).trim();
      const rest = spaceIdx === -1 ? '' : head.slice(spaceIdx + 1).trim();
      const args = rest === '' ? [] : tokenizeArgs(rest);
      // Slash 命令必带 sessionId；若无 session 自动建一个再执行
      setBusy(true);
      let sid: string | null = null;
      try {
        sid = await ensureSession();
      } finally {
        setBusy(false);
      }
      if (!sid) return; // err 已 setErr
      setPrompt('');
      await execSlashOrSkill(sid, name, args);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      // 用户输入即"我要开始对话"——不再强制 "Select or create a session first"
      const sid = await ensureSession();
      if (!sid) return;
      appendUserMessage(sid, trimmed);
      const promptForAI = trimmed;
      setPrompt('');
      // Auto-title：仅在 session 当前无 title 时设置，避免覆盖用户手动重命名。
      // fire-and-forget — 失败不影响 send。
      const sessNow = useAppStore.getState().sessions.find((s) => s.sessionId === sid);
      if (sessNow && !sessNow.title) {
        const title = deriveTitle(trimmed);
        if (title) {
          void window.kodaxSpace.invoke('session.setTitle', { sessionId: sid, title }).then((r) => {
            if (r.ok) upsertSession({ ...sessNow, title });
          });
        }
      }
      // P0c: 把发送的 prompt 推进历史（appendInputHistory 内部 trim + dedup）— 用 anchored form
      appendInputHistory(sid, trimmed);
      // P0c: 重置 history 浏览指针
      setHistoryIdx(-1);
      draftRef.current = '';
      // P0a: spinner 立即亮起（在 invoke 前置位，event 到达时由 store appendEvent 清掉）
      setPendingSend(sid, true);
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: sid,
        prompt: promptForAI,
      });
      if (!result.ok) {
        setPendingSend(sid, false);
        // v0.1.4 B3: 失败 → 把刚 optimistic append 的 user message 回滚掉，避免一条孤
        // 零零气泡留在对话流。setErr 仍然显示，让用户看到错误原因。
        rollbackLastUserMessage(sid, promptForAI);
        // review event-channel LOW-2: handleSend 之前已经 setPrompt(''); IPC 失败后
        // 用户的 prompt 文本本来会丢，只能 ↑ 历史 recall。这里恢复 textarea 内容 +
        // 鼠标 focus 让用户能立即重发/编辑。draftRef 之前也清成 '' 了，一并恢复。
        setPrompt(promptForAI);
        draftRef.current = promptForAI;
        setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
      } else if (result.data.queued) {
        // v0.1.4 B1: session 正在跑，prompt 进了 KodaX SDK MessageQueue。spinner 已经亮
        // （上一轮在跑），不动 pendingSend。toast 提示用户消息已排队，不必再追着发。
        pushToast('Queued — will run after the current turn finishes', 'info');
      }
    } finally {
      setBusy(false);
    }
  }

  function onSlashPick(item: SlashPickerItem | null): void {
    if (item === null) {
      setPrompt('');
      return;
    }
    const hint = item.kind === 'slash' ? item.meta.argsHint : item.meta.argumentHint;
    if (!hint) {
      // 无参数 → 直接执行（已知 kind 走对应 IPC）。
      // ensureSession 在无 session 时建一个；execSlashDirect/invokeSkill 自己管 busy。
      setPrompt('');
      void (async () => {
        const sid = await ensureSession();
        if (!sid) return;
        if (item.kind === 'slash') {
          await execSlashDirect(sid, item.meta.name, []);
        } else {
          // invokeSkill 不管 busy（注释里说由 caller 包），所以这里包一次
          setBusy(true);
          setErr(null);
          try {
            await invokeSkill(sid, item.meta.name, []);
          } finally {
            setBusy(false);
          }
        }
      })();
    } else {
      // 有参数 → 把 "/name " 放回输入框等用户继续输入。Enter 后 handleSend → execSlashOrSkill；
      // 自动按 unknownCommand 信号 fallback 到 skill.invoke，行为对用户一致。
      setPrompt(`/${item.meta.name} `);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('session.cancel', { sessionId: currentSessionId });
    if (r.ok) pushToast('Stop signal sent', 'info', 2000);
    else pushToast(r.error?.message ?? 'Cancel failed', 'error');
  }


  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      // F031: slash 模式下让 SlashCommandPopover 的 onPick (window keydown) 处理 Enter
      // textarea 这层不 preventDefault，避免双重触发（handleSend + popover.onPick）
      if (slashMode) {
        // 仍 preventDefault 防 textarea 插入换行（Enter 默认行为）
        e.preventDefault();
        return;
      }
      e.preventDefault();
      void handleSend();
      return;
    }
    // P0c: ↑/↓ 历史翻阅 — 仅在光标在 textarea 第一行 (↑) 或最后行 (↓) 触发，
    // 让多行编辑里的 ↑↓ 仍是浏览器原生光标移动。空 history 不响应。
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && inputHistory.length > 0) {
      const ta = e.currentTarget;
      const value = ta.value;
      const caret = ta.selectionStart ?? 0;
      const firstLineEnd = value.indexOf('\n');
      const isOnFirstLine = firstLineEnd === -1 || caret <= firstLineEnd;
      const isOnLastLine = caret >= value.lastIndexOf('\n') + 1 || value.indexOf('\n') === -1;

      if (e.key === 'ArrowUp' && isOnFirstLine) {
        // 首次按 ↑ → 保存 draft，然后取最近一条
        if (historyIdx === -1) draftRef.current = value;
        const nextIdx =
          historyIdx === -1 ? inputHistory.length - 1 : Math.max(0, historyIdx - 1);
        e.preventDefault();
        setHistoryIdx(nextIdx);
        setPrompt(inputHistory[nextIdx]);
        return;
      }
      if (e.key === 'ArrowDown' && isOnLastLine && historyIdx !== -1) {
        e.preventDefault();
        if (historyIdx + 1 >= inputHistory.length) {
          // 回到 draft
          setHistoryIdx(-1);
          setPrompt(draftRef.current);
        } else {
          const nextIdx = historyIdx + 1;
          setHistoryIdx(nextIdx);
          setPrompt(inputHistory[nextIdx]);
        }
        return;
      }
    }
    // 用户开始打字 / 输入 → 取消历史浏览态（不打扰编辑）
    if (
      historyIdx !== -1 &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      setHistoryIdx(-1);
      // 不还原 draft——用户已经在 history 项上手动编辑了，应当 keep 当前内容
    }
  }

  const isStreaming = useIsStreaming();
  const canSend =
    !busy && !isStreaming && prompt.trim().length > 0 && !!currentProjectPath;

  return (
    // Claude Desktop 同款"贴底浮起卡片"。ActivitySpinner / err 仍在外层（瞬态指示，
    // 不应挤压 input card 的视觉重量）。card 用 zinc-900/60 衬色 + 一圈极淡 border，
    // 比"顶 border-t + 三段堆叠"更整体。
    <div className="px-3 pt-1 pb-3 flex-shrink-0 space-y-1">
      {err && <div className="text-red-400 text-[11px] font-mono px-1">{err}</div>}

      {/* 持久内联通知 (REPL NotificationsSurface 等价) — auto-engine fallback 等 */}
      <NotificationsSurface />

      {/* Git working tree dirty 提示 (REPL StashNotice 等价)。非 git repo / clean 时返回 null */}
      <StashNotice />

      {/* Provider retry / recovery / rate-limit 实时提示 (REPL StatusNoticesSurface 等价) */}
      <RetryBanner />

      {/* P5: AMA agent 形态时展示 worker / harness / 子任务计数 */}
      <AmaWorkStrip />

      {/* REPL BackgroundTaskBar 等价: 多 subagent 并发时按 workerId 聚合显示 chip 条 */}
      <BackgroundTaskBar />

      {/* v0.1.4：流式 spinner 搬去了 ConversationStreamV2 末尾 —— 对齐 VSCode
          Claude Code "正在做什么"放在历史下方紧邻输入框上的位置感。
          这里只保留 useIsStreaming hook 的 import（Send/Stop 按钮还在用）。*/}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 pt-2 pb-2 space-y-1.5 shadow-sm focus-within:border-zinc-700 transition-colors">
        <ChipBar />

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => {
              setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
            }}
            onClick={(e) => {
              setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
            }}
            onKeyDown={(e) => {
              // AtPathPopover 优先消费 Tab/Enter/↑↓/Esc (它注册了 handler)
              if (atPathKeyHandlerRef.current) {
                const consumed = atPathKeyHandlerRef.current(e.nativeEvent);
                if (consumed) {
                  // popover 内部已 preventDefault,不走 BottomBar 原 onKeyDown 逻辑
                  return;
                }
              }
              onKeyDown(e);
              // 键按下后 caret 可能移动;下一帧读最新位置
              requestAnimationFrame(() => {
                const ta = textareaRef.current;
                if (ta) setCaret(ta.selectionStart ?? 0);
              });
            }}
            disabled={busy || !currentProjectPath}
            rows={2}
            placeholder={
              !currentProjectPath
                ? 'Open a folder first — Ctrl+O'
                : currentSessionId
                  ? 'Describe a task or ask a question — Type / for commands'
                  : 'Describe a task or ask a question — session will be created on send'
            }
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none px-0.5 py-1 pr-44 disabled:opacity-50"
          />
          {/* Context window indicator + queue badge 浮在输入框右下角 */}
          <div className="absolute right-1 bottom-1 pointer-events-auto flex items-center gap-3">
            <QueueIndicator />
            <ContextWindowIndicator />
          </div>
          {/* F031: slash 补全 popover — prompt trim 后以 '/' 开头且未含空白时显示 */}
          {slashMode && (
            <SlashCommandPopover query={trimmedPrompt} onPick={onSlashPick} />
          )}
          {/* @path 文件补全 popover (REPL SuggestionsDisplay 等价)。slash 模式时不显示避免抢键盘。 */}
          {!slashMode && (
            <AtPathPopover
              text={prompt}
              caret={caret}
              projectRoot={currentProjectPath}
              onAccept={(replacement, tokenStart, tokenEnd) => {
                const next = prompt.slice(0, tokenStart) + replacement + prompt.slice(tokenEnd);
                setPrompt(next);
                const newCaret = tokenStart + replacement.length;
                requestAnimationFrame(() => {
                  const live = textareaRef.current;
                  if (!live) return;
                  live.focus();
                  try { live.setSelectionRange(newCaret, newCaret); } catch { /* ignore */ }
                  setCaret(newCaret);
                });
              }}
              registerKeyHandler={(h) => {
                atPathKeyHandlerRef.current = h;
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="w-5 h-5 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 text-sm flex items-center justify-center"
              title="Attach / Commands"
              aria-label="Open attach menu"
            >
              ＋
            </button>
            <AttachMenu
              open={attachOpen}
              onClose={() => setAttachOpen(false)}
              onInsertText={(text) => setPrompt((p) => (p ? `${p} ${text}` : text))}
            />
          </div>
          <AgentPicker insertAtCaret={insertAtCaret} />
          <ModeSelector />
          <AgentModeSelector />
          <span className="ml-auto" />
          <ModelEffortSelector />
          {/* Send / Stop 圆形按钮 — Claude Code / ChatGPT 同款。streaming 时变成 Stop。
              亮 / 暗双主题: enable 态都是绿/红 + 白字 (色相饱和不变);
              disable 态分主题做 — 暗 zinc-800 衬 zinc-500 字, 亮 zinc-300 衬 zinc-500 字,
              保证按钮在白底卡片上仍能"看得见"而不是融化掉。 */}
          {isStreaming ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              className="ml-1 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-sm"
              title="Stop (Esc)"
              aria-label="Stop generation"
            >
              <span aria-hidden className="block w-2.5 h-2.5 bg-white rounded-[1px]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={[
                'ml-1 w-7 h-7 rounded-full flex items-center justify-center disabled:cursor-not-allowed shadow-sm',
                // Enable: 暗/亮都用 emerald 绿 + 白字
                'bg-emerald-600 hover:bg-emerald-500 text-white',
                // Disable (dark): 暗灰圈 + 中灰箭头
                'dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500',
                // Disable (light): 用 zinc-300 衬底 + zinc-500 字 → 白底卡片上仍可见
                'disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none',
              ].join(' ')}
              title={canSend ? 'Send (Enter)' : 'Type a message first'}
              aria-label="Send message"
            >
              <span aria-hidden className="text-sm leading-none">↑</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

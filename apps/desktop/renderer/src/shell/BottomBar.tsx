// BottomBar — F011-revised
//
// 三层结构（自下而上）：
//   1. Footer-row：Mode/Gateway 左下，Model+Effort 右下（弹出选择）
//   2. InputBox：textarea + Send/Cancel
//   3. ChipBar：Local · Project · branch · worktree-flag
//
// 取代旧 EventStream 底部 InputBox 区。

import { useState } from 'react';
import type { SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { AttachMenu } from './AttachMenu.js';
import { SlashCommandPopover, type SlashPickerItem } from './SlashCommandPopover.js';
import { resolveSessionCreateInputs } from './createSession.js';
import { ActivitySpinner, useIsStreaming } from './ActivitySpinner.js';

/**
 * F031 helper：按空白切 args，保留双引号包裹的整段。
 * 上限 20 与 slashExecChannel 的 z.array(...).max(20) 一致——超出后停切，
 * 避免恶意粘贴在 renderer 端就预分配巨大数组。
 */
const SLASH_ARGS_MAX = 20;

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
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const setPendingReasoningMode = useAppStore((s) => s.setPendingReasoningMode);
  const setPendingPermissionMode = useAppStore((s) => s.setPendingPermissionMode);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const resetSessionMessages = useAppStore((s) => s.resetSessionMessages);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

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
    const { provider, reasoningMode, permissionMode } = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode,
    });
    const result = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider,
      reasoningMode,
      permissionMode,
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
      title: undefined,
      createdAt: result.data.createdAt,
      lastActivityAt: result.data.createdAt,
    };
    upsertSession(stub);
    setCurrentSession(stub.sessionId);
    // 消费 pending（既然 session 已经按 pending 建立，pending 状态使命完成）
    setPendingProviderId(null);
    setPendingReasoningMode(null);
    setPendingPermissionMode(null);
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
    appendUserMessage(sessionId, `/${name} ${args.join(' ')}`.trim());
    const sendResult = await window.kodaxSpace.invoke('session.send', {
      sessionId,
      prompt: resolvedPrompt,
    });
    if (!sendResult.ok) {
      setErr(`${sendResult.error?.code ?? 'ERR_UNKNOWN'}: ${sendResult.error?.message ?? 'unknown error'}`);
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
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: sid,
        prompt: trimmed,
      });
      if (!result.ok) setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
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
    await window.kodaxSpace.invoke('session.cancel', { sessionId: currentSessionId });
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
    }
  }

  const isStreaming = useIsStreaming();
  const canSend =
    !busy && !isStreaming && prompt.trim().length > 0 && !!currentProjectPath;

  return (
    <div className="border-t border-zinc-900 px-3 py-2 flex-shrink-0 space-y-1.5">
      {err && <div className="text-red-400 text-[11px] font-mono px-1">{err}</div>}

      {/* 流式响应时显示 spinner + 实时 status / iter / tokens */}
      <ActivitySpinner />

      <ChipBar />

      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || !currentProjectPath}
          rows={2}
          placeholder={
            !currentProjectPath
              ? 'Open a folder first — Ctrl+O'
              : currentSessionId
                ? 'Describe a task or ask a question — Type / for commands'
                : 'Describe a task or ask a question — session will be created on send'
          }
          className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-400 resize-none focus:outline-none px-1 py-1 pr-44 disabled:opacity-50"
        />
        {/* Context window indicator 浮在输入框右下角 — Claude Desktop 截图 3 同款位置 */}
        <div className="absolute right-1 bottom-1 pointer-events-auto">
          <ContextWindowIndicator />
        </div>
        {/* F031: slash 补全 popover — prompt trim 后以 '/' 开头且未含空白时显示 */}
        {slashMode && (
          <SlashCommandPopover query={trimmedPrompt} onPick={onSlashPick} />
        )}
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        <div className="relative">
          <button
            type="button"
            onClick={() => setAttachOpen((v) => !v)}
            className="w-5 h-5 rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-sm flex items-center justify-center"
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
        <ModeSelector />
        <span className="ml-auto" />
        <ModelEffortSelector />
        {/* Send / Stop 圆形按钮 — Claude Code / ChatGPT 同款。streaming 时变成 Stop。*/}
        {isStreaming ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="ml-1 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center"
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
            className="ml-1 w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white flex items-center justify-center disabled:cursor-not-allowed"
            title={canSend ? 'Send (Enter)' : 'Type a message first'}
            aria-label="Send message"
          >
            <span aria-hidden className="text-sm leading-none">↑</span>
          </button>
        )}
      </div>
    </div>
  );
}

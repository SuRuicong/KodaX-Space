// BottomBar — F011-revised
//
// 三层结构（自下而上）：
//   1. Footer-row：Mode/Gateway 左下，Model+Effort 右下（弹出选择）
//   2. InputBox：textarea + Send/Cancel
//   3. ChipBar：Local · Project · branch · worktree-flag
//
// 取代旧 EventStream 底部 InputBox 区。

import { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { AttachMenu } from './AttachMenu.js';
import { SlashCommandPopover } from './SlashCommandPopover.js';
import type { SlashCommandMeta } from '@kodax-space/space-ipc-schema';

/**
 * F031 helper：按空白切 args，保留双引号包裹的整段。
 * 上限 20 与 slashExecChannel 的 z.array(...).max(20) 一致——超出后停切，
 * 避免恶意粘贴在 renderer 端就预分配巨大数组。
 */
const SLASH_ARGS_MAX = 20;
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
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const resetSessionMessages = useAppStore((s) => s.resetSessionMessages);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  /**
   * slash 模式：trim 后以 '/' 起头、且不含空白（仍在敲命令名）。
   * 用 trimmed 而非 raw 是为了让 ` /help`（前导空格、粘贴常见）也能弹补全；
   * 用 \s 而非空格能同时识别 \n \t（多行/粘贴）。
   */
  const trimmedPrompt = prompt.trimStart();
  const slashMode = trimmedPrompt.startsWith('/') && !/\s/.test(trimmedPrompt);

  async function execSlash(name: string, args: string[]): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.kodaxSpace.invoke('slash.exec', {
        sessionId: currentSessionId,
        name,
        args,
      });
      if (!result.ok) {
        setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
        return;
      }
      const { ok, message, echo, clearStream } = result.data;
      if (echo && message) {
        // F031: /help /clear 等命令把 message 当 system_notice 显示
        appendUserMessage(currentSessionId, `/${name} ${args.join(' ')}`.trim());
      }
      if (clearStream) {
        // F031: 由 handler 显式请求清空消息流（不再 hardcode name === 'clear'）。
        resetSessionMessages(currentSessionId);
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

  async function handleSend(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const trimmed = prompt.trim();
    if (trimmed === '') return;
    // F031: 以 `/` 起头视为 slash 命令；按空白切 name + args，调 slash.exec
    if (trimmed.startsWith('/')) {
      const head = trimmed.slice(1);
      const spaceIdx = head.search(/\s/);
      const name = (spaceIdx === -1 ? head : head.slice(0, spaceIdx)).trim();
      const rest = spaceIdx === -1 ? '' : head.slice(spaceIdx + 1).trim();
      const args = rest === '' ? [] : tokenizeArgs(rest);
      setPrompt('');
      await execSlash(name, args);
      return;
    }
    setErr(null);
    setBusy(true);
    appendUserMessage(currentSessionId, trimmed);
    setPrompt('');
    try {
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: currentSessionId,
        prompt: trimmed,
      });
      if (!result.ok) setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  function onSlashPick(cmd: SlashCommandMeta | null): void {
    if (cmd === null) {
      setPrompt('');
      return;
    }
    // 命令选中后：
    //   - 无参数 hint → 直接执行
    //   - 有参数 → 把 "/name " 放回输入框等用户继续输入
    if (!cmd.argsHint) {
      setPrompt('');
      void execSlash(cmd.name, []);
    } else {
      setPrompt(`/${cmd.name} `);
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

  return (
    <div className="border-t border-zinc-900 px-3 py-2 flex-shrink-0 space-y-1.5">
      {err && <div className="text-red-400 text-[11px] font-mono px-1">{err}</div>}

      <ChipBar />

      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || !currentSessionId}
          rows={2}
          placeholder={
            currentSessionId
              ? 'Describe a task or ask a question — Type / for commands'
              : 'Select or create a session first'
          }
          className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none px-1 py-1 pr-44 disabled:opacity-50"
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
            disabled={!currentSessionId}
            className="w-5 h-5 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:text-zinc-700 disabled:cursor-not-allowed text-sm flex items-center justify-center"
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
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!busy}
          className="text-zinc-600 hover:text-zinc-300 disabled:text-zinc-700 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <span className="ml-auto" />
        <ModelEffortSelector />
      </div>
    </div>
  );
}

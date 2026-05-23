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
import { SlashCommandPopover, type SlashPickerItem } from './SlashCommandPopover.js';

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

  /**
   * Slash 命令分两步：
   *   1) slash.exec — main 端有 builtin handler 时直接执行
   *   2) 若 main 返回 unknownCommand:true → 调 execSkill 试 skill registry
   * busy 状态在外部包裹 (execSlashOrSkill)，避免中间放掉 → 用户能并发触发新命令。
   */
  async function execSlashOrSkill(name: string, args: string[]): Promise<void> {
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
      const { ok, message, echo, clearStream, unknownCommand } = result.data;
      // F035: slash 找不到 → 试 skill。用 unknownCommand 字段（reviewer HIGH-3：
      // 不再字符串匹配 message）。
      if (unknownCommand) {
        await invokeSkill(name, args);
        return;
      }
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

  /** 仅 popover 直接点中 slash 命令（已知 builtin、无 fallback 必要）时用。*/
  async function execSlashDirect(name: string, args: string[]): Promise<void> {
    // 这层薄壳保持与原 execSlash 相同的 busy 语义但不做 skill fallback。
    // 当前实现复用 execSlashOrSkill；future 若需要细分语义可分开。
    await execSlashOrSkill(name, args);
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
  async function invokeSkill(name: string, args: string[]): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const result = await window.kodaxSpace.invoke('skill.invoke', {
      sessionId: currentSessionId,
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
    appendUserMessage(currentSessionId, `/${name} ${args.join(' ')}`.trim());
    const sendResult = await window.kodaxSpace.invoke('session.send', {
      sessionId: currentSessionId,
      prompt: resolvedPrompt,
    });
    if (!sendResult.ok) {
      setErr(`${sendResult.error?.code ?? 'ERR_UNKNOWN'}: ${sendResult.error?.message ?? 'unknown error'}`);
    }
  }

  async function handleSend(): Promise<void> {
    if (!currentSessionId || !window.kodaxSpace) return;
    const trimmed = prompt.trim();
    if (trimmed === '') return;
    // F031: 以 `/` 起头视为 slash 命令；按空白切 name + args，调 slash.exec
    // F035: 直接 type `/skill-name args` 也走 slash.exec —— 但 skill 不在 slash registry，
    // slash.exec 返回 unknown command 后 fall through 到 skill 路径。
    // 简化：handleSend 仍只走 slash.exec；用户从 popover 选 skill 走 onSlashPick → execSkill。
    if (trimmed.startsWith('/')) {
      const head = trimmed.slice(1);
      const spaceIdx = head.search(/\s/);
      const name = (spaceIdx === -1 ? head : head.slice(0, spaceIdx)).trim();
      const rest = spaceIdx === -1 ? '' : head.slice(spaceIdx + 1).trim();
      const args = rest === '' ? [] : tokenizeArgs(rest);
      setPrompt('');
      await execSlashOrSkill(name, args);
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

  function onSlashPick(item: SlashPickerItem | null): void {
    if (item === null) {
      setPrompt('');
      return;
    }
    const hint = item.kind === 'slash' ? item.meta.argsHint : item.meta.argumentHint;
    if (!hint) {
      // 无参数 → 直接执行（已知 kind 走对应 IPC）
      setPrompt('');
      if (item.kind === 'slash') {
        void execSlashDirect(item.meta.name, []);
      } else {
        // skill 也用 busy 包裹
        setBusy(true);
        setErr(null);
        void invokeSkill(item.meta.name, []).finally(() => setBusy(false));
      }
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
            disabled={!currentSessionId}
            className="w-5 h-5 rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed text-sm flex items-center justify-center"
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
          className="text-zinc-300 hover:text-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <span className="ml-auto" />
        <ModelEffortSelector />
      </div>
    </div>
  );
}

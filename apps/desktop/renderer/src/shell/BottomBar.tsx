// BottomBar — F011-revised
//
// 三层结构（自下而上）：
//   1. Footer-row：Mode/Gateway 左下，Model+Effort 右下（弹出选择）
//   2. InputBox：textarea + Send/Cancel
//   3. ChipBar：Local · Project · branch · worktree-flag
//
// 取代旧 EventStream 底部 InputBox 区。

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Plus, X } from 'lucide-react';
import type { InputArtifact, SessionMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { useSurfaceStore } from '../store/surface.js';
import { ChipBar } from './ChipBar.js';
import { ModelEffortSelector } from './ModelEffortSelector.js';
import { ModeSelector } from './ModeSelector.js';
import { ContextWindowIndicator } from './ContextWindowIndicator.js';
import { QueueIndicator } from './QueueIndicator.js';
import { AttachMenu } from './AttachMenu.js';
import { AgentPicker } from './AgentPicker.js';
import { AtPathPopover } from './AtPathPopover.js';
import { SlashCommandPopover, type SlashPickerItem } from './SlashCommandPopover.js';
import { registerInsertReceiver } from './inputBridge.js';
import { resolveSessionCreateInputs } from './createSession.js';
import { useIsStreaming } from './ActivitySpinner.js';
import { AgentModeSelector } from './AgentModeSelector.js';
import { AmaWorkStrip } from './AmaWorkStrip.js';
import { BackgroundTaskBar } from './BackgroundTaskBar.js';
// F041 v0.1.4 retire：StashNotice 横幅退役，其职责由 RightSidebar.ChangesSection 文件列表上位替代
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
// OC-31 v0.1.9 — composer 中已粘贴 / 上传但尚未发送的 image 一条。
// path 是 main 端 clipboard.saveImage 写盘后返回的绝对路径，会被塞进 session.send.artifacts；
// dataUrl 仅前端缩略图渲染用 — 落盘已经发生，dataUrl 是为了避免再读回文件。
interface PendingImage {
  /** main 端写盘后的绝对路径。发送时填进 artifacts[i].path。 */
  readonly path: string;
  /** image/png | image/jpeg | image/webp。 */
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 文件实际字节数，用于 chip 上显示 "230 KB"。 */
  readonly bytes: number;
  /** 渲染缩略图用的 data: URL（base64 编码后挂在 <img src>）。 */
  readonly dataUrl: string;
  /** 显示名 — clipboard 来源固定 "Pasted image"，drag-drop 时是原文件名。 */
  readonly label: string;
}

// 6 MiB — 与 IPC schema MAX_IMAGE_BYTES 对齐 (Anthropic / OpenAI base64 上限分位)
const MAX_PASTE_BYTES = 6 * 1024 * 1024;
const MAX_PENDING_IMAGES = 8;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 把 Blob 转 base64 (去掉 data: 前缀)，FileReader 不需 import 模块。 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const r = String(reader.result ?? '');
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

function deriveTitle(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;
  // 取前 N 字符，单行
  const oneLine = trimmed.replace(/\s+/g, ' ');
  const sliced =
    oneLine.length > TITLE_MAX_CHARS ? oneLine.slice(0, TITLE_MAX_CHARS).trimEnd() + '…' : oneLine;
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

function scanArgSpans(rest: string): Array<{ value: string; end: number }> {
  const result: Array<{ value: string; end: number }> = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push({ value: m[1] ?? m[2] ?? '', end: re.lastIndex });
  }
  return result;
}

function tokenizeWorkflowArgs(rest: string): string[] {
  const trimmed = rest.trim();
  if (trimmed === '') return [];
  const spans = scanArgSpans(trimmed);
  const first = spans[0];
  if (!first) return [];
  const command = first.value.toLowerCase();
  const tailAfter = (span: { end: number }): string => trimmed.slice(span.end).trim();
  if (command === 'create') {
    const request = tailAfter(first);
    return request ? ['create', request] : ['create'];
  }
  if (command === 'revise') {
    const args = ['revise'];
    let targetIndex = 1;
    if (spans[1]?.value === '--replace') {
      args.push('--replace');
      targetIndex = 2;
    }
    const target = spans[targetIndex];
    if (!target) return args;
    args.push(target.value);
    const request = tailAfter(target);
    if (request) args.push(request);
    return args;
  }
  if (command === 'rename' || command === 'rerun') {
    const target = spans[1];
    if (!target) return [command];
    const tail = tailAfter(target);
    return tail ? [command, target.value, tail] : [command, target.value];
  }
  const subcommands = new Set([
    'help', 'list', 'ls', 'runs', 'show', 'pause', 'resume', 'stop', 'delete', 'prune', 'save',
  ]);
  if (!subcommands.has(command)) {
    const rawArgs = tailAfter(first);
    return rawArgs ? [first.value, rawArgs] : [first.value];
  }
  return spans.slice(0, 20).map((span) => span.value);
}

const STATIC_SLASH_ARG_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  mode: ['plan', 'accept-edits', 'auto'],
  'auto-engine': ['llm', 'rules'],
  'agent-mode': ['ama', 'amaw', 'ama-workflow', 'sa', 'toggle'],
  am: ['ama', 'amaw', 'ama-workflow', 'sa', 'toggle'],
  reasoning: ['off', 'auto', 'quick', 'balanced', 'deep'],
  reason: ['off', 'auto', 'quick', 'balanced', 'deep'],
  thinking: ['on', 'off', 'auto', 'quick', 'balanced', 'deep'],
  think: ['on', 'off', 'auto', 'quick', 'balanced', 'deep'],
  t: ['on', 'off', 'auto', 'quick', 'balanced', 'deep'],
  auto: ['auto'],
  a: ['auto'],
  fallback: ['status', 'off'],
  'verifier-log': ['on', 'off'],
  'stall-log': ['on', 'off'],
  mcp: ['status', 'refresh'],
  status: ['workspace', 'worktree', 'runtime', 'peers'],
  info: ['workspace', 'worktree', 'runtime', 'peers'],
  ctx: ['workspace', 'worktree', 'runtime', 'peers'],
  paste: ['list', 'show', 'help'],
};

function shouldOpenStaticSlashArgCompletion(trimmedPrompt: string): boolean {
  const match = trimmedPrompt.match(/^\/([^\s]+)\s+(\S*)$/);
  if (!match) return false;
  const command = match[1]?.toLowerCase() ?? '';
  const arg = match[2]?.toLowerCase() ?? '';
  const options = STATIC_SLASH_ARG_OPTIONS[command];
  if (!options) return false;
  return arg.length > 0 && !options.includes(arg);
}

function shouldOpenWorkflowSlashCompletion(trimmedPrompt: string): boolean {
  const match = trimmedPrompt.match(/^\/workflow(?:\s+(.*))?$/i);
  if (!match) return false;
  const rest = match[1] ?? '';
  if (rest === '') return true;

  const spans = scanArgSpans(rest);
  const endsWithSpace = /\s$/.test(trimmedPrompt);
  const first = spans[0]?.value.toLowerCase();
  if (!first) return true;

  // While editing the first workflow token, keep subcommand / workflow-name completion.
  if (spans.length === 1 && !endsWithSpace) return true;

  // These subcommands take free-form text after the subcommand/target. Once the
  // user reaches that free-form position, Enter should execute, not autocomplete.
  if (first === 'create' || first === 'help' || first === 'list' || first === 'ls') return false;

  if (first === 'revise') {
    const targetIndex = spans[1]?.value === '--replace' ? 2 : 1;
    const target = spans[targetIndex];
    if (!target) return true;
    return !endsWithSpace && spans.length === targetIndex + 1;
  }

  if (first === 'rename' || first === 'rerun') {
    const target = spans[1];
    if (!target) return true;
    return !endsWithSpace && spans.length === 2;
  }

  if (first === 'save') {
    const runId = spans[1];
    if (!runId) return true;
    return !endsWithSpace && spans.length === 2;
  }

  if (first === 'runs' && spans.at(-2)?.value === '--limit') return false;
  if (first === 'prune' && ['--keep', '--older-than'].includes(spans.at(-2)?.value ?? '')) return false;

  const completionSubcommands = new Set([
    'runs', 'show', 'pause', 'resume', 'stop', 'delete', 'prune',
  ]);
  return completionSubcommands.has(first);
}

function slashEchoText(name: string, args: readonly string[]): string {
  return `/${name} ${args.join(' ')}`.trim();
}

function workflowPendingMessage(name: string, args: readonly string[]): string | null {
  if (name.toLowerCase() !== 'workflow') return null;
  const first = args[0]?.toLowerCase();
  if (!first) return null;
  if (first === 'create' && (args[1]?.trim().length ?? 0) > 0) {
    return 'generating workflow...';
  }
  if (first === 'revise') {
    const request = args[1] === '--replace' ? args[3] : args[2];
    return request?.trim() ? 'revising workflow...' : null;
  }
  if (first === 'rerun' && args[1]?.trim()) return 'starting workflow...';

  const nonStartingSubcommands = new Set([
    'help', 'list', 'ls', 'runs', 'show', 'pause', 'resume', 'stop',
    'delete', 'prune', 'save', 'rename',
  ]);
  return nonStartingSubcommands.has(first) ? null : 'starting workflow...';
}

export function BottomBar(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  // F045: 新建 session 落在当前工作面（Coder / Partner）——写盘成 SDK session tag。
  const currentSurface = useSurfaceStore((s) => s.currentSurface);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const kodaxDefaults = useAppStore((s) => s.kodaxDefaults);
  const pendingProviderId = useAppStore((s) => s.pendingProviderId);
  const pendingModel = useAppStore((s) => s.pendingModel);
  const pendingReasoningMode = useAppStore((s) => s.pendingReasoningMode);
  const pendingPermissionMode = useAppStore((s) => s.pendingPermissionMode);
  const pendingAgentMode = useAppStore((s) => s.pendingAgentMode);
  const setPendingProviderId = useAppStore((s) => s.setPendingProviderId);
  const appendUserMessage = useAppStore((s) => s.appendUserMessage);
  const appendEvent = useAppStore((s) => s.appendEvent);
  const rollbackLastUserMessage = useAppStore((s) => s.rollbackLastUserMessage);
  const resetSessionMessages = useAppStore((s) => s.resetSessionMessages);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setPendingSend = useAppStore((s) => s.setPendingSend);
  const appendInputHistory = useAppStore((s) => s.appendInputHistory);
  const inputHistory = useAppStore((s) =>
    currentSessionId
      ? (s.inputHistoryBySession[currentSessionId] ?? EMPTY_INPUT_HISTORY)
      : EMPTY_INPUT_HISTORY,
  );
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  /**
   * OC-31 v0.1.9 — composer 已挂上待发送的 image。每张图都已经落到 main 端 temp 目录,
   * 这里只缓存渲染所需信息 + path（发送时塞 session.send.artifacts）。
   * 上限 8 张 / 一次发送，与 IPC schema 对齐（DoS guard + 视觉不爆）。
   */
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  /** 粘贴 / 上传后的错误（image 太大、IPC fail），独立于全局 err，关掉后不影响发送。*/
  const [imageErr, setImageErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** P0c: ↑/↓ 翻历史时的指针：-1 = 未浏览（输入框是用户当前 draft），0..n-1 = 看历史第 i 条。*/
  const [historyIdx, setHistoryIdx] = useState(-1);
  /** 在用户首次按 ↑ 之前，缓存 draft，回到 idx=-1 时还原。 */
  const draftRef = useRef<string>('');

  /** caret 实时位置 (跟 prompt 一起喂给 AtPathPopover 判断是否在 @token 里)。 */
  const [caret, setCaret] = useState(0);
  /** AtPathPopover 注册的 keydown 拦截器; 优先消费 Tab/Enter/↑↓/Esc 用于选项 */
  const atPathKeyHandlerRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);

  /** AgentPicker / CommandPalette 用: 将 text 插入 textarea 当前 caret 位置 (替换 selection 区间)。
   *  用 setPrompt 的 functional updater 形式 — closure 不再依赖 `prompt`，可被注册到
   *  长寿命 receiver（inputBridge）而不需要每键击重订阅。caret start/end 从 DOM 读取，
   *  与 React state 无关，永远是当前值。*/
  function insertAtCaret(text: string): void {
    const ta = textareaRef.current;
    if (!ta) {
      setPrompt((p) => p + text);
      return;
    }
    const start = ta.selectionStart ?? -1;
    const end = ta.selectionEnd ?? -1;
    setPrompt((current) => {
      const s = start >= 0 ? start : current.length;
      const e = end >= 0 ? end : current.length;
      return current.slice(0, s) + text + current.slice(e);
    });
    // 还原焦点 + 把 caret 移到插入位置之后 (下一帧 textarea 已经反映新值)。
    // rAF 期间组件可能 unmount/remount (路由切换等),旧 `ta` 变 detached node。
    // 重新读 ref 拿当前真实节点 (审查 M4)。
    const newPos = (start >= 0 ? start : ta.value.length) + text.length;
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

  // F059b: artifact "再改一版" → prefill the composer with a revision instruction
  // and focus it (caret at end). The user appends the change + sends; the agent
  // reuses the artifactId in create_artifact to produce a new version.
  useEffect(() => {
    const onPrefill = (e: Event): void => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (typeof detail?.text !== 'string') return;
      setPrompt(detail.text);
      const len = detail.text.length; // use the known length, not the (maybe-stale) DOM value
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(len, len);
        setCaret(len);
      });
    };
    window.addEventListener('kodax-space.compose-prefill', onPrefill);
    return () => window.removeEventListener('kodax-space.compose-prefill', onPrefill);
  }, []);

  // F026 ⌘K 命令面板桥：CommandPalette 选 file / slash 项时把 `@path` / `/cmd `
  // 通过 inputBridge 模块私有 registry 路由到这里 → 插当前 caret。
  // 不用 window CustomEvent（避免任意 renderer JS 都能向输入框注入文本的 ambient cap）。
  // insertAtCaret 用 functional setPrompt 不闭包当前 prompt — 安全注册一次即可，无需重订阅。
  useEffect(() => {
    return registerInsertReceiver((text) => {
      // 长度兜底：避免上游异常超长字符串塞入 textarea 拖死渲染
      const safe = text.length > 4096 ? text.slice(0, 4096) : text;
      insertAtCaret(safe);
    });
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
    const { provider, reasoningMode, permissionMode, agentMode, model } = resolveSessionCreateInputs({
      projectRoot: currentProjectPath,
      providers,
      defaultProviderId,
      kodaxDefaults,
      pendingProviderId,
      pendingReasoningMode,
      pendingPermissionMode,
      pendingAgentMode,
      pendingModel,
    });
    const result = await window.kodaxSpace.invoke('session.create', {
      projectRoot: currentProjectPath,
      provider,
      reasoningMode,
      permissionMode,
      agentMode,
      // 显式带上生效 model，让 SDK 应用 per-model 能力（正确的 contextWindow → 压缩窗口）。
      ...(model ? { model } : {}),
      // F045: 新 session 归当前工作面；main 落盘成 SDK session tag，决定它在哪个面的列表出现。
      surface: currentSurface,
    });
    if (!result.ok) {
      setErr(`${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'create failed'}`);
      return null;
    }
    const stub: SessionMeta = {
      sessionId: result.data.sessionId,
      projectRoot: currentProjectPath,
      provider,
      ...(model ? { model } : {}),
      reasoningMode,
      permissionMode,
      autoModeEngine: 'llm',
      agentMode,
      surface: currentSurface,
      title: undefined,
      createdAt: result.data.createdAt,
      lastActivityAt: result.data.createdAt,
    };
    upsertSession(stub);
    setCurrentSession(stub.sessionId);
    // 仅消费 provider 的 pending（provider 有独立 defaultProviderId 兜底）；mode 类
    // pending（permission / reasoning / agent）现在等同"用户首选"，持久化在 LS 留下次默认
    setPendingProviderId(null);
    // 刷新权威列表（让 LeftSidebar Recents 立即看到新条目）。F045: 按当前 surface 拉，
    // 与 LeftSidebar 的分面列表一致（否则新建后刷新会把另一面的 session 也灌进来）。
    void window.kodaxSpace.invoke('session.list', {
      projectRoot: currentProjectPath,
      surface: currentSurface,
    }).then((listResult) => {
      if (listResult.ok) {
        useAppStore.getState().replaceSessionsForScope(listResult.data.sessions, {
          projectRoot: currentProjectPath,
          surface: currentSurface,
        });
      }
    }).catch(() => {});
    return stub.sessionId;
  }

  /**
   * OC-31 v0.1.9 — 把一组 File / Blob (来自 clipboard paste 或 drag-drop) 落到 main temp
   * 目录并挂到 composer。每张都需要：
   *   1. mediaType 合法 (image/png|jpeg|webp)
   *   2. 单张 ≤ 6 MiB (与 schema MAX_IMAGE_BYTES 对齐)
   *   3. 已挂总数 + 新增 ≤ 8 张
   *   4. 当前已有 sessionId — 否则先建。session.create 失败时不挂图、不消费 prompt 区。
   */
  async function attachImages(blobs: readonly File[]): Promise<void> {
    if (blobs.length === 0) return;
    if (!window.kodaxSpace) return;

    setImageErr(null);

    // review LOW-4 fix: 先过 mime/size/count 验证，**全部 reject** 才不 ensureSession —
    // 避免用户粘贴 PDF / .tiff 等不支持文件类型时凭空建出一个空 session。
    const accepted: File[] = [];
    for (const b of blobs) {
      if (!/^image\/(png|jpeg|webp)$/.test(b.type)) {
        setImageErr(`Unsupported image type: ${b.type || 'unknown'}. PNG / JPEG / WEBP only.`);
        continue;
      }
      if (b.size > MAX_PASTE_BYTES) {
        setImageErr(
          `Image too large: ${formatBytes(b.size)}. Max ${formatBytes(MAX_PASTE_BYTES)}.`,
        );
        continue;
      }
      if (pendingImages.length + accepted.length >= MAX_PENDING_IMAGES) {
        setImageErr(`Max ${MAX_PENDING_IMAGES} images per send.`);
        break;
      }
      accepted.push(b);
    }
    if (accepted.length === 0) return;

    // sessionId 是 IPC 路径的一部分（main 端按 sid 分子目录）。没 session 时建一个；
    // 失败立即返回 — 复用 ensureSession 的 setErr 即可。
    const sid = await ensureSession();
    if (!sid) return;

    const saved: PendingImage[] = [];
    for (const b of accepted) {
      try {
        const base64 = await blobToBase64(b);
        const r = await window.kodaxSpace.invoke('clipboard.saveImage', {
          sessionId: sid,
          base64,
          mediaType: b.type as PendingImage['mediaType'],
        });
        if (!r.ok) {
          setImageErr(`${r.error?.code ?? 'ERR_UNKNOWN'}: ${r.error?.message ?? 'save failed'}`);
          continue;
        }
        saved.push({
          path: r.data.path,
          mediaType: b.type as PendingImage['mediaType'],
          bytes: r.data.bytes,
          dataUrl: `data:${b.type};base64,${base64}`,
          label: b.name && b.name !== 'image.png' ? b.name : 'Pasted image',
        });
      } catch (e) {
        setImageErr(e instanceof Error ? e.message : String(e));
      }
    }
    if (saved.length > 0) {
      setPendingImages((prev) => [...prev, ...saved]);
    }
  }

  function removePendingImage(idx: number): void {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  /**
   * slash 模式：trim 后以 '/' 起头、且不含空白（仍在敲命令名）。
   * 用 trimmed 而非 raw 是为了让 ` /help`（前导空格、粘贴常见）也能弹补全；
   * 用 \s 而非空格能同时识别 \n \t（多行/粘贴）。
  */
  const trimmedPrompt = prompt.trimStart();
  const isWorkflowSlashPrompt = shouldOpenWorkflowSlashCompletion(trimmedPrompt);
  const slashArgTrailingMode = /^\/[^\s]+\s$/i.test(trimmedPrompt);
  const slashMode = trimmedPrompt.startsWith('/')
    && (!/\s/.test(trimmedPrompt)
      || isWorkflowSlashPrompt
      || slashArgTrailingMode
      || shouldOpenStaticSlashArgCompletion(trimmedPrompt));

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
    if (!window.kodaxSpace) {
      setErr('IPC unavailable');
      appendUserMessage(sessionId, '[slash] IPC unavailable');
      return;
    }
    const pendingWorkflowMessage = workflowPendingMessage(name, args);
    const optimisticWorkflow = pendingWorkflowMessage !== null;
    const commandEcho = slashEchoText(name, args);
    setBusy(true);
    setErr(null);
    if (optimisticWorkflow) {
      appendUserMessage(sessionId, commandEcho);
      appendUserMessage(sessionId, `[workflow] ${pendingWorkflowMessage}`);
    }
    try {
      const result = await window.kodaxSpace.invoke('slash.exec', {
        sessionId,
        name,
        args,
      });
      if (!result.ok) {
        if (optimisticWorkflow) {
          appendUserMessage(
            sessionId,
            `[workflow] IPC failed: ${result.error?.message ?? 'unknown error'}`,
          );
        }
        setErr(
          `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`,
        );
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
        // F031: show the command and the handler feedback in the conversation stream.
        if (!optimisticWorkflow) appendUserMessage(sessionId, commandEcho);
        if (!clearStream) appendUserMessage(sessionId, message);
      }
      if (clearStream) {
        // F031: 由 handler 显式请求清空消息流（不再 hardcode name === 'clear'）。
        resetSessionMessages(sessionId);
      }
      if (!ok && message) {
        if (optimisticWorkflow) appendUserMessage(sessionId, `[workflow] ${message}`);
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
        } else if (
          lastText.length > 0 &&
          (ev.kind === 'tool_result' || ev.kind === 'session_start')
        ) {
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
          const e = ev as {
            iter?: number;
            maxIter?: number;
            tokenCount?: number;
            usage?: { inputTokens?: number; outputTokens?: number };
          };
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

    if (action === 'show-repointel-status') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[repointel] IPC unavailable');
        return;
      }
      const traces = events.filter((ev) => ev.kind === 'repointel_trace');
      const result = await window.kodaxSpace.invoke('repointel.status', {
        projectRoot: state.currentProjectPath ?? undefined,
      });
      if (!result.ok) {
        appendUserMessage(
          sessionId,
          `[repointel] status failed: ${result.error?.message ?? 'unknown'}`,
        );
        return;
      }
      const status = result.data;
      const lines = [
        '[repointel] status:',
        `  project: ${status.projectRoot ?? '(none)'}`,
        `  project exists: ${status.projectExists ? 'yes' : 'no'}`,
        `  git root: ${status.gitRoot ?? '(not detected)'}`,
        `  trace source: ${status.traceSource}`,
        `  recent session traces: ${traces.length}`,
        `  warm: ${status.warmSupported ? 'supported' : 'unsupported'}`,
        `  warm reason: ${status.warmReason}`,
        '  diagnostics:',
        ...status.diagnostics.map((d) => `    - [${d.status}] ${d.id}: ${d.detail}`),
      ];
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-repointel-trace' || action === 'show-repointel') {
      // events buffer 倒序找最近 8 条 repointel_trace
      const traces: Array<{
        kind: string;
        mode?: string;
        engine?: string;
        status?: string;
        latencyMs?: number;
        cacheHit?: boolean;
      }> = [];
      for (let i = events.length - 1; i >= 0 && traces.length < 8; i--) {
        const ev = events[i];
        if (ev.kind === 'repointel_trace') {
          // event 字段在 ZodSchema 中是 nested 在 .event 里
          const e = (ev as { event?: (typeof traces)[number] }).event;
          if (e) traces.unshift(e);
        }
      }
      if (traces.length === 0) {
        appendUserMessage(
          sessionId,
          '[repointel] no traces yet — KodaX repo-intelligence has not emitted any events this session',
        );
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
      // F046 review HIGH-2: Partner 面 Shell 不挂 PopoutOverlay（仅 Coder 分支挂），
      // 直接 requestPopout('agents') 会静默无反应。surface-gate + 明确告知，避免"按了没反应"。
      if (currentSurface === 'partner') {
        appendUserMessage(sessionId, '/memory 在 Coder 面使用（Partner 面暂无 AGENTS.md popout）。');
        return;
      }
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
      const r = await window.kodaxSpace.invoke('project.gitDiff', {
        projectRoot: currentProjectPath,
      });
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
      const truncationNote = r.data.truncated
        ? '\n\n*(diff truncated at 64KB — full review may need narrower scope)*'
        : '';
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
        appendUserMessage(
          sessionId,
          `[status] listRunning failed: ${r.error?.message ?? 'unknown'}`,
        );
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
        const ageLabel =
          ageSec < 60
            ? `${ageSec}s`
            : ageSec < 3600
              ? `${Math.floor(ageSec / 60)}m`
              : `${Math.floor(ageSec / 3600)}h`;
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
        appendUserMessage(
          sessionId,
          `[doctor] provider.list failed: ${r.error?.message ?? 'unknown'}`,
        );
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

      const lines: string[] = [
        `[doctor] ${providers.length} provider(s), default = ${r.data.defaultProviderId ?? '(none)'}, keychain = ${r.data.keychainBackend}`,
      ];
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

    if (action === 'exit-app') {
      pushToast('Closing KodaX Space', 'info', 1200);
      window.close();
      return;
    }

    if (action === 'reload-context') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[reload] IPC unavailable');
        return;
      }
      const lines = ['[reload] refreshed:'];
      if (currentProjectPath) {
        const skills = await window.kodaxSpace.invoke('skill.discover', {
          projectRoot: currentProjectPath,
          forceReload: true,
        });
        lines.push(
          skills.ok
            ? `  skills: ${skills.data.skills.length}`
            : `  skills: failed (${skills.error?.message ?? 'unknown'})`,
        );
      } else {
        lines.push('  skills: skipped (no project)');
      }
      const mcp = await window.kodaxSpace.invoke('mcp.reload', undefined);
      lines.push(
        mcp.ok
          ? `  mcp: ${mcp.data.ok ? 'ok' : 'not reloaded'} (${mcp.data.serverCount} server(s))`
          : `  mcp: failed (${mcp.error?.message ?? 'unknown'})`,
      );
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-extensions') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[extensions] no project / IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('mcp.discover', { projectRoot: currentProjectPath });
      if (!r.ok) {
        appendUserMessage(sessionId, `[extensions] discover failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const lines = [`[extensions] ${r.data.servers.length} MCP extension/server(s):`];
      if (r.data.servers.length === 0) lines.push('  none configured');
      for (const server of r.data.servers.slice(0, 30)) {
        const target = server.transport === 'http'
          ? (server.url ?? '(no url)')
          : [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
        lines.push(`  ${server.name}  ${server.source}  ${server.transport}  ${target}`);
      }
      if (r.data.servers.length > 30) lines.push(`  ... ${r.data.servers.length - 30} more`);
      if (r.data.errors.length > 0) {
        lines.push('Errors:');
        lines.push(...r.data.errors.slice(0, 8).map((e) => `  ${e.path}: ${e.error}`));
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'show-mcp') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[mcp] IPC unavailable');
        return;
      }
      if (args[0]?.toLowerCase() === 'refresh') {
        const reload = await window.kodaxSpace.invoke('mcp.reload', undefined);
        if (!reload.ok) {
          appendUserMessage(sessionId, `[mcp] reload failed: ${reload.error?.message ?? 'unknown'}`);
          return;
        }
      }
      const r = await window.kodaxSpace.invoke('mcp.servers', undefined);
      if (!r.ok) {
        appendUserMessage(sessionId, `[mcp] servers failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const prefix = args[0]?.toLowerCase() === 'refresh' ? '[mcp] reloaded; ' : '[mcp] ';
      const lines = [`${prefix}${r.data.servers.length} server(s):`];
      if (r.data.servers.length === 0) lines.push('  none configured');
      for (const server of r.data.servers) {
        const dirty = server.dirty ? ' dirty' : '';
        const cached = server.cachedAt ? ` cached=${server.cachedAt}` : '';
        const err = server.lastError ? ` error=${server.lastError}` : '';
        lines.push(
          `  ${server.serverId}  ${server.status}/${server.connect}  tools=${server.tools} resources=${server.resources} prompts=${server.prompts}${dirty}${cached}${err}`,
        );
      }
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'list-sessions') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[sessions] IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('session.list', {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
        surface: currentSurface,
      });
      if (!r.ok) {
        appendUserMessage(sessionId, `[sessions] list failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      state.replaceSessionsForScope(r.data.sessions, {
        ...(currentProjectPath ? { projectRoot: currentProjectPath } : {}),
        surface: currentSurface,
      });
      const lines = [`[sessions] ${r.data.sessions.length} session(s):`];
      for (const s of r.data.sessions.slice(0, 40)) {
        const title = s.title ? `  ${s.title}` : '';
        const count = s.msgCount !== undefined ? `  ${s.msgCount} msg(s)` : '';
        lines.push(`  ${s.sessionId}${title}${count}  ${new Date(s.lastActivityAt).toLocaleString()}`);
      }
      if (r.data.sessions.length > 40) lines.push(`  ... ${r.data.sessions.length - 40} more`);
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    if (action === 'load-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[load] IPC unavailable');
        return;
      }
      const target = args[0];
      if (!target) {
        appendUserMessage(sessionId, '[load] Usage: /load <session-id>');
        return;
      }
      const r = await window.kodaxSpace.invoke('session.list', undefined);
      if (!r.ok) {
        appendUserMessage(sessionId, `[load] list failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const found = r.data.sessions.find((s) => s.sessionId === target || s.sessionId.startsWith(target));
      if (!found) {
        appendUserMessage(sessionId, `[load] session not found: ${target}`);
        return;
      }
      state.upsertSession(found);
      state.setCurrentSession(found.sessionId);
      appendUserMessage(sessionId, `[load] switched to ${found.sessionId}${found.title ? ` (${found.title})` : ''}`);
      return;
    }

    if (action === 'delete-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[delete] IPC unavailable');
        return;
      }
      const target = args[0];
      if (!target) {
        appendUserMessage(sessionId, '[delete] Usage: /delete <session-id>');
        return;
      }
      const r = await window.kodaxSpace.invoke('session.delete', { sessionId: target });
      if (!r.ok) {
        appendUserMessage(sessionId, `[delete] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.deleted) {
        appendUserMessage(sessionId, `[delete] session not found: ${target}`);
        return;
      }
      state.removeSession(target);
      if (target === sessionId) state.setCurrentSession(null);
      appendUserMessage(sessionId, `[delete] deleted session ${target}`);
      return;
    }

    if (action === 'fork-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[fork] IPC unavailable');
        return;
      }
      const session = state.sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        appendUserMessage(sessionId, '[fork] current session is not in the renderer list');
        return;
      }
      if (args[0] && !/^\d+$/.test(args[0])) {
        appendUserMessage(sessionId, '[fork] entry-id/label selection is not exposed in Space yet; forking current branch.');
      }
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      const requestedIdx = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
      const forkPointTurnIdx = Math.max(
        0,
        Math.min(requestedIdx ?? userMsgs.length - 1, Math.max(0, userMsgs.length - 1)),
      );
      const r = await window.kodaxSpace.invoke('session.fork', { sessionId, forkPointTurnIdx });
      if (!r.ok) {
        appendUserMessage(sessionId, `[fork] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const childTitle = session.title !== undefined
        ? `${session.title.replace(/( \(fork\))+$/, '')} (fork)`
        : undefined;
      state.upsertSession({
        ...session,
        sessionId: r.data.newSessionId,
        title: childTitle,
        createdAt: r.data.createdAt,
        lastActivityAt: r.data.createdAt,
        parentSessionId: sessionId,
        forkPointTurnIdx,
      });
      state.forkSessionBuffers(sessionId, r.data.newSessionId, forkPointTurnIdx);
      state.setCurrentSession(r.data.newSessionId);
      appendUserMessage(sessionId, `[fork] created ${r.data.newSessionId} from turn ${forkPointTurnIdx}`);
      return;
    }

    if (action === 'rewind-session') {
      if (!window.kodaxSpace) {
        appendUserMessage(sessionId, '[rewind] IPC unavailable');
        return;
      }
      const userMsgs = state.userMessagesBySession[sessionId] ?? [];
      if (userMsgs.length === 0) {
        appendUserMessage(sessionId, '[rewind] nothing to rewind; no turns yet');
        return;
      }
      if (args[0] && !/^\d+$/.test(args[0])) {
        appendUserMessage(sessionId, '[rewind] entry-id/label selection is not exposed in Space yet; rewinding one turn.');
      }
      const onlyOneTurn = userMsgs.length === 1;
      const requestedIdx = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : undefined;
      const rewindPastTurnIdx = Math.max(
        0,
        Math.min(requestedIdx ?? (onlyOneTurn ? 0 : userMsgs.length - 2), Math.max(0, userMsgs.length - 1)),
      );
      const r = await window.kodaxSpace.invoke('session.rewind', { sessionId, rewindPastTurnIdx });
      if (!r.ok) {
        appendUserMessage(sessionId, `[rewind] failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      if (!r.data.ok) {
        appendUserMessage(sessionId, `[rewind] rejected: ${r.data.reason ?? 'unknown'}`);
        return;
      }
      if (onlyOneTurn && requestedIdx === undefined) state.resetSessionMessages(sessionId);
      else state.rewindSessionBuffers(sessionId, rewindPastTurnIdx);
      appendUserMessage(sessionId, `[rewind] rewound to turn ${rewindPastTurnIdx}`);
      return;
    }

    if (action === 'list-skills') {
      if (!window.kodaxSpace || !currentProjectPath) {
        appendUserMessage(sessionId, '[skills] no project / IPC unavailable');
        return;
      }
      const r = await window.kodaxSpace.invoke('skill.discover', {
        projectRoot: currentProjectPath,
        forceReload: true,
      });
      if (!r.ok) {
        appendUserMessage(sessionId, `[skills] discover failed: ${r.error?.message ?? 'unknown'}`);
        return;
      }
      const lines = [`[skills] ${r.data.skills.length} skill(s):`];
      if (r.data.skills.length === 0) lines.push('  none found');
      for (const skill of r.data.skills.slice(0, 40)) {
        const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
        lines.push(`  /skill:${skill.name}${hint}  ${skill.description}`);
      }
      if (r.data.skills.length > 40) lines.push(`  ... ${r.data.skills.length - 40} more`);
      appendUserMessage(sessionId, lines.join('\n'));
      return;
    }

    // 未知 action — 兜底显示原 message
    appendUserMessage(sessionId, `[unknown action: ${action}]`);
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
    // 把 "/skill:name args" 当一条 user message 显示（与补全/输入的 namespace 一致）。
    const skillEcho = `/skill:${name} ${args.join(' ')}`.trim();
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
      setErr(
        `${sendResult.error?.code ?? 'ERR_UNKNOWN'}: ${sendResult.error?.message ?? 'unknown error'}`,
      );
    } else if (sendResult.data.queued) {
      pushToast('Queued — will run after the current turn finishes', 'info');
    }
  }

  async function handleSend(): Promise<void> {
    if (!window.kodaxSpace) return;
    const trimmed = prompt.trim();
    // OC-31 v0.1.9 — 允许"只贴图不带文字"。SDK 接受带 image artifact 的空文本 prompt（content
    // 数组里只有 image block），由 LLM 决定该如何回应。为避免 SDK 端 prompt empty 边界，
    // 这里补一句占位文本（与 Claude.ai 桌面端"Pasted image" 行为对齐）。
    const effectivePrompt = trimmed !== '' ? trimmed : pendingImages.length > 0 ? '(image)' : '';
    if (effectivePrompt === '') return;
    if (trimmed.startsWith('/')) {
      const head = trimmed.slice(1);
      const spaceIdx = head.search(/\s/);
      const token = (spaceIdx === -1 ? head : head.slice(0, spaceIdx)).trim();
      const rest = spaceIdx === -1 ? '' : head.slice(spaceIdx + 1).trim();
      const args = rest === ''
        ? []
        : token.toLowerCase() === 'workflow'
          ? tokenizeWorkflowArgs(rest)
          : tokenizeArgs(rest);
      // v0.1.10 fix: 解析 `/skill:<name>` namespace, 跟 KodaX REPL 对齐。
      // 命中时直接走 invokeSkill 不走 slash.exec → unknownCommand → fallback 二跳。
      const skillNamespaceMatch = token.match(/^skill:(.+)$/);
      setBusy(true);
      let sid: string | null = null;
      try {
        sid = await ensureSession();
      } finally {
        setBusy(false);
      }
      if (!sid) return; // err 已 setErr
      setPrompt('');
      if (skillNamespaceMatch) {
        // 已是 /skill:name 显式 namespace, 直接走 invokeSkill
        setBusy(true);
        setErr(null);
        try {
          await invokeSkill(sid, skillNamespaceMatch[1]!, args);
        } finally {
          setBusy(false);
        }
      } else {
        // 兼容旧 /<name>: slash command 走 slash.exec, unknownCommand 内部 fallback skill
        await execSlashOrSkill(sid, token, args);
      }
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      // 用户输入即"我要开始对话"——不再强制 "Select or create a session first"
      const sid = await ensureSession();
      if (!sid) return;
      appendUserMessage(sid, effectivePrompt);
      const promptForAI = effectivePrompt;
      // 把发送瞬间的图片快照下来 —— 失败回滚时直接 setPendingImages(imagesAtSend)
      // 即可恢复，包括 dataUrl 缩略图 (不用重新从 main 读文件转 base64)。
      const imagesAtSend = pendingImages;
      const artifactsForSend: InputArtifact[] | undefined =
        imagesAtSend.length > 0
          ? imagesAtSend.map((img) => ({
              kind: 'image' as const,
              path: img.path,
              mediaType: img.mediaType,
              source: 'user-inline' as const,
            }))
          : undefined;
      setPrompt('');
      setPendingImages([]);
      setImageErr(null);
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
      // review LOW-5 fix: 用户纯图片发送时 trimmed === ''，不该污染 ↑/↓ 历史
      // （否则浏览历史会出现空条目）。effectivePrompt='(image)' 占位也不进史。
      if (trimmed !== '') {
        appendInputHistory(sid, trimmed);
      }
      // P0c: 重置 history 浏览指针
      setHistoryIdx(-1);
      draftRef.current = '';
      // P0a: spinner 立即亮起（在 invoke 前置位，event 到达时由 store appendEvent 清掉）
      setPendingSend(sid, true);
      const result = await window.kodaxSpace.invoke('session.send', {
        sessionId: sid,
        prompt: promptForAI,
        ...(artifactsForSend ? { artifacts: artifactsForSend } : {}),
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
        // OC-31 v0.1.9: 同理把 image chips 也复位 — 文件还在 main temp 目录里，path
        // 还能再次用。otherwise 用户失败一次就丢图，得重新粘贴。
        if (imagesAtSend.length > 0) {
          setPendingImages((prev) => (prev.length === 0 ? imagesAtSend : prev));
        }
        setErr(
          `${result.error?.code ?? 'ERR_UNKNOWN'}: ${result.error?.message ?? 'unknown error'}`,
        );
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
    // 选中 = **补全到输入框**（不再自动执行）。用户复报：一点击/回车就直接发出去、体验很差。
    // 现在统一把 `/<cmd> ` 或 `/skill:<name> ` 插进输入框，让用户补 args / 复核后再按 Enter 发送。
    // 尾空格使 slashMode 关闭 → 补全弹窗收起；handleSend 认 `/skill:` 前缀走 invokeSkill。
    const insertText =
      item.kind === 'workflow'
        ? item.insertText
        : item.kind === 'slash-arg'
          ? item.insertText
        : item.kind === 'skill'
          ? `/skill:${item.meta.name} `
          : `/${item.meta.name} `;
    setPrompt(insertText);
    // 焦点拉回输入框，光标在末尾，用户可直接续打。
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }

  function handleCancel(): void {
    const sid = currentSessionId;
    if (!sid || !window.kodaxSpace) return;
    appendEvent({
      kind: 'session_error',
      sessionId: sid,
      error: 'cancelled',
      category: 'cancelled',
      retriable: true,
    });
    pushToast('Stop signal sent', 'info', 2000);
    void window.kodaxSpace
      .invoke('session.cancel', { sessionId: sid })
      .then((r) => {
        if (!r.ok) pushToast(r.error?.message ?? 'Cancel failed', 'error');
      })
      .catch((err: unknown) => {
        pushToast(err instanceof Error ? err.message : 'Cancel failed', 'error');
      });
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
        const nextIdx = historyIdx === -1 ? inputHistory.length - 1 : Math.max(0, historyIdx - 1);
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
    if (historyIdx !== -1 && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setHistoryIdx(-1);
      // 不还原 draft——用户已经在 history 项上手动编辑了，应当 keep 当前内容
    }
  }

  const isStreaming = useIsStreaming();
  // OC-31 v0.1.9 — 文字非空 OR 至少有一张挂上的 image 即可发送（与 Claude.ai 桌面端
  // "光贴图就能发"一致）。
  const canSend =
    !busy &&
    !isStreaming &&
    !!currentProjectPath &&
    (prompt.trim().length > 0 || pendingImages.length > 0);
  const sendButtonTitle = canSend
    ? 'Send (Enter)'
    : !currentProjectPath
      ? 'Open a folder first'
      : busy
        ? 'Command is running'
        : 'Type a message first';

  return (
    // Claude Desktop 同款"贴底浮起卡片"。ActivitySpinner / err 仍在外层（瞬态指示，
    // 不应挤压 input card 的视觉重量）。card 用 zinc-900/60 衬色 + 一圈极淡 border，
    // 比"顶 border-t + 三段堆叠"更整体。
    <div className="ix-zone px-3 pt-1 pb-3 flex-shrink-0 space-y-1">
      {err && <div className="text-danger text-xs font-mono px-1">{err}</div>}

      {/* 持久内联通知 (REPL NotificationsSurface 等价) — auto-engine fallback 等 */}
      <NotificationsSurface />

      {/* F041 v0.1.4: 原 StashNotice 横幅退役 — 文件级变动列表见 RightSidebar.ChangesSection。
          BottomBar 不再挂载 git working-tree 横幅，让对话主区干净。 */}

      {/* Provider retry / recovery / rate-limit 实时提示 (REPL StatusNoticesSurface 等价) */}
      <RetryBanner />

      {/* P5: AMA agent 形态时展示 worker / harness / 子任务计数。
          F046: Partner 面隐藏——AMA/harness 是编码形态概念，Partner（doc-workspace）不展示。 */}
      {currentSurface !== 'partner' && <AmaWorkStrip />}

      {/* REPL BackgroundTaskBar 等价: 多 subagent 并发时按 workerId 聚合显示 chip 条。
          F046: 同 AmaWorkStrip，Partner 面隐藏子 agent 并发条。 */}
      {currentSurface !== 'partner' && <BackgroundTaskBar />}

      {/* v0.1.4：流式 spinner 搬去了 ConversationStreamV2 末尾 —— 对齐 VSCode
          Claude Code "正在做什么"放在历史下方紧邻输入框上的位置感。
          这里只保留 useIsStreaming hook 的 import（Send/Stop 按钮还在用）。*/}

      <div className="glass lift rounded-2xl border border-border-default bg-surface-2 px-3 pt-2 pb-2 space-y-1.5 focus-within:border-accent/50 transition-colors">
        <ChipBar />

        {/* OC-31 v0.1.9 — pending image chips。粘贴/拖入的图片以缩略图 + 删除按钮形式展示，
         *  发送时一起送到 KodaX SDK (KodaXContextOptions.inputArtifacts)。 */}
        {(pendingImages.length > 0 || imageErr) && (
          <div className="space-y-1">
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingImages.map((img, idx) => (
                  <div
                    key={img.path}
                    className="group relative inline-flex items-center gap-1.5 bg-surface-3 border border-border-default rounded-md pl-1 pr-1.5 py-0.5 text-xs text-fg-secondary"
                    title={`${img.label} · ${formatBytes(img.bytes)}`}
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.label}
                      className="w-7 h-7 rounded object-cover flex-shrink-0"
                    />
                    <span className="max-w-[120px] truncate">{img.label}</span>
                    <span className="text-fg-muted">{formatBytes(img.bytes)}</span>
                    <button
                      type="button"
                      onClick={() => removePendingImage(idx)}
                      className="ml-0.5 w-4 h-4 rounded-full text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center justify-center leading-none"
                      aria-label={`Remove ${img.label}`}
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {imageErr && <div className="text-xs text-warn">{imageErr}</div>}
          </div>
        )}

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
            onPaste={(e) => {
              // OC-31 v0.1.9 — clipboard 里有 image 文件就拦下 → 走 attachImages；
              // 没 image (纯文本粘贴) 直接 fall through 用浏览器原生行为，不干扰用户。
              const items = e.clipboardData?.files;
              if (!items || items.length === 0) return;
              const images: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const f = items[i];
                if (f && f.type.startsWith('image/')) images.push(f);
              }
              if (images.length === 0) return;
              e.preventDefault();
              void attachImages(images);
            }}
            // Only block typing while a slash/skill command is mid-flight. NOT on
            // !currentProjectPath: during boot/session-open the project path hydrates
            // async, and disabling here made the input dead ("click → no response,
            // like loading") until it resolved. Sending is still gated by canSend
            // (which requires currentProjectPath) + ensureSession's own guard, so
            // typing early is safe — the prompt just can't send until a project is set.
            disabled={busy}
            rows={2}
            placeholder={
              !currentProjectPath
                ? 'Open a folder first — Ctrl+O'
                : currentSessionId
                  ? 'Describe a task or ask a question — Type / for commands'
                  : 'Describe a task or ask a question — session will be created on send'
            }
            className="w-full bg-transparent text-sm text-fg-primary placeholder-fg-muted resize-none focus:outline-none px-0.5 py-1 pr-44 disabled:opacity-50"
          />
          {/* Context window indicator + queue badge 浮在输入框右下角 */}
          <div className="absolute right-1 bottom-1 pointer-events-auto flex items-center gap-3">
            <QueueIndicator />
            <ContextWindowIndicator />
          </div>
          {/* F031: slash 补全 popover — prompt trim 后以 '/' 开头且未含空白时显示 */}
          {slashMode && <SlashCommandPopover query={trimmedPrompt} onPick={onSlashPick} />}
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
                  try {
                    live.setSelectionRange(newCaret, newCaret);
                  } catch {
                    /* ignore */
                  }
                  setCaret(newCaret);
                });
              }}
              registerKeyHandler={(h) => {
                atPathKeyHandlerRef.current = h;
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="w-6 h-6 rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-primary flex items-center justify-center"
              title="Attach / Commands"
              aria-label="Open attach menu"
            >
              <Plus className="w-4 h-4" />
            </button>
            <AttachMenu
              open={attachOpen}
              onClose={() => setAttachOpen(false)}
              onInsertText={(text) => setPrompt((p) => (p ? `${p} ${text}` : text))}
            />
          </div>
          {/* F046: AgentPicker（@子agent 插入）/ AgentModeSelector（AMA·SA）是编码形态控件，
              Partner 面隐藏；保留 ModeSelector（权限：写 artifact 仍需门控）+ ModelEffortSelector。 */}
          {currentSurface !== 'partner' && <AgentPicker insertAtCaret={insertAtCaret} />}
          <ModeSelector />
          {currentSurface !== 'partner' && <AgentModeSelector />}
          <span className="ml-auto" />
          <ModelEffortSelector />
          {/* Send / Stop 按钮 (F054 hero CTA)。Send = 唯一享 .btn-accent gradient+辉光的强调按钮；
              streaming 时变 Stop (danger 红)。disable 态用 surface-3 衬 fg-muted，白底卡片上仍可见。 */}
          {isStreaming ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              className="ml-1 w-8 h-8 rounded-lg bg-danger hover:brightness-110 text-white flex items-center justify-center shadow-sm transition-[filter]"
              title="Stop (Esc)"
              aria-label="Stop generation"
            >
              <span aria-hidden className="block w-2.5 h-2.5 bg-white rounded-[2px]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={[
                'ml-1 w-8 h-8 rounded-lg flex items-center justify-center disabled:cursor-not-allowed',
                canSend ? 'btn-accent' : 'bg-surface-3 text-fg-muted',
              ].join(' ')}
              title={sendButtonTitle}
              aria-label="Send message"
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

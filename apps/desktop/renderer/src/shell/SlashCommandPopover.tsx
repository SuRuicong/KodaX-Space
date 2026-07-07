// SlashCommandPopover — FEATURE_031 + FEATURE_035.
//
// 用户在底部输入框输入 `/` 触发：
//   - 拉 slash.discover + skill.discover 各一次（已缓存就不再拉）
//   - 合并显示：slash command 与 skill 并列，按 name 字典序
//   - 上下键选中、Tab 补全；Esc 关闭
//
// 不在 BottomBar 内部直接 inline 实现，独立组件方便 future 让 attach-menu 也复用同补全。

import { useEffect, useRef, useState } from 'react';
import type {
  ProviderInfo,
  SessionMeta,
  SlashCommandMeta,
  SkillMeta,
  WorkflowRunT,
} from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { safeSkillSlashText, skillSlashInsertText } from './skillSlash.js';
import { useI18n } from '../i18n/I18nProvider.js';

/**
 * 统一的 picker 项类型——把 slash command 和 skill 合并成一个列表。
 *   - kind 'slash' → BottomBar 走 slash.exec
 *   - kind 'skill' → BottomBar 走 skill.invoke → session.send
 */
export type SlashPickerItem =
  | { readonly kind: 'slash'; readonly meta: SlashCommandMeta }
  | {
      readonly kind: 'skill';
      readonly meta: SkillMeta;
      readonly displayName: string;
      readonly insertText: string;
    }
  | {
      readonly kind: 'workflow';
      readonly label: string;
      readonly insertText: string;
      readonly description: string;
      readonly argsHint?: string;
    }
  | {
      readonly kind: 'slash-arg';
      readonly label: string;
      readonly insertText: string;
      readonly description: string;
      readonly argsHint?: string;
    };

export interface SlashCommandPopoverProps {
  /** 当前输入框文本（含 leading `/`）。父组件按需 mount/unmount 本组件。*/
  readonly query: string;
  readonly registerKeyHandler?: (handler: ((e: KeyboardEvent) => boolean) | null) => void;
  /**
   * 用户选中条目并按回车（或点击）后回调。父组件接管 input clear + IPC exec。
   * item === null 表示用户按 Esc 关闭弹窗。
   */
  readonly onPick: (item: SlashPickerItem | null) => void;
}

let cachedCommands: SlashCommandMeta[] | null = null;
// FEATURE_035: skill 缓存 per-session—— skill list 由 projectRoot 决定，
// 切 session 可能进了不同 project（不同 .kodax/skills/）。
let cachedSkills: { projectRoot: string; list: SkillMeta[] } | null = null;

interface WorkflowLibraryLite {
  readonly builtin: readonly { readonly name: string; readonly description?: string }[];
  readonly saved: readonly {
    readonly name: string;
    readonly path: string;
    readonly source?: string;
    readonly execution?: string;
  }[];
}

const WORKFLOW_SUBCOMMANDS: ReadonlyArray<{
  readonly label: string;
  readonly description: string;
  readonly argsHint?: string;
}> = [
  { label: 'help', description: 'Show workflow usage' },
  { label: 'list', description: 'List built-in, pattern, and saved workflows' },
  { label: 'runs', description: 'List workflow runs', argsHint: '[--all|--limit N]' },
  { label: 'show', description: 'Show a workflow run', argsHint: '[--full] [runId]' },
  { label: 'pause', description: 'Pause a workflow run', argsHint: '<runId>' },
  { label: 'resume', description: 'Resume a workflow run', argsHint: '<runId>' },
  { label: 'stop', description: 'Stop the latest active workflow or a run', argsHint: '[runId]' },
  {
    label: 'delete',
    description: 'Delete a workflow run or saved workflow',
    argsHint: '[--force] [--run|--saved] <target>',
  },
  {
    label: 'prune',
    description: 'Preview or clean old workflow runs',
    argsHint: '--dry-run|--keep N|--older-than Nd',
  },
  {
    label: 'rerun',
    description: 'Rerun a generated run or saved workflow',
    argsHint: '<runId|savedName> [args]',
  },
  {
    label: 'save',
    description: 'Save a generated workflow run as a capsule',
    argsHint: '<runId> <name>',
  },
  {
    label: 'rename',
    description: 'Rename a run display name or generated saved workflow',
    argsHint: '<runId|savedName> <newName>',
  },
  {
    label: 'revise',
    description: 'Generate and save a revised workflow capsule',
    argsHint: '[--replace] <runId|savedName> <change>',
  },
  {
    label: 'create',
    description: 'Generate and start a workflow from natural language',
    argsHint: '<request>',
  },
];

function scanWorkflowSpans(rest: string): Array<{ value: string; start: number; end: number }> {
  const result: Array<{ value: string; start: number; end: number }> = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    result.push({ value: m[1] ?? m[2] ?? '', start: m.index, end: re.lastIndex });
  }
  return result;
}

function applyWorkflowCompletion(query: string, replacement: string): string {
  const q = query.trimStart();
  const after = q.replace(/^\/workflow\b/i, '').replace(/^\s*/, '');
  if (!after) return `/workflow ${replacement} `;
  if (/\s$/.test(q)) return `${q}${replacement} `;
  const spans = scanWorkflowSpans(after);
  const last = spans.at(-1);
  if (!last) return `/workflow ${replacement} `;
  return `/workflow ${after.slice(0, last.start)}${replacement} `;
}

function applySlashArgCompletion(query: string, replacement: string): string {
  const q = query.trimStart();
  const commandMatch = q.match(/^\/([^\s]+)/);
  const command = commandMatch?.[1] ?? '';
  if (!command) return `/${replacement} `;
  const after = q.slice(command.length + 1).replace(/^\s*/, '');
  if (!after) return `/${command} ${replacement} `;
  if (/\s$/.test(q)) return `${q}${replacement} `;
  const spans = scanWorkflowSpans(after);
  const last = spans.at(-1);
  if (!last) return `/${command} ${replacement} `;
  return `/${command} ${after.slice(0, last.start)}${replacement} `;
}

function workflowTitle(run: WorkflowRunT): string {
  return run.displayName || run.workflowName || run.runId;
}

function pickerItemName(item: SlashPickerItem): string {
  return item.kind === 'workflow' || item.kind === 'slash-arg' ? item.label : item.meta.name;
}

function workflowSuggestion(
  query: string,
  label: string,
  description: string,
  argsHint?: string,
): SlashPickerItem {
  return {
    kind: 'workflow',
    label,
    insertText: applyWorkflowCompletion(query, label),
    description,
    ...(argsHint ? { argsHint } : {}),
  };
}

function buildWorkflowSuggestions(
  query: string,
  library: WorkflowLibraryLite | null,
  runs: readonly WorkflowRunT[],
): readonly SlashPickerItem[] {
  const q = query.trimStart();
  const after = q.replace(/^\/workflow\b/i, '').replace(/^\s*/, '');
  const spans = scanWorkflowSpans(after);
  const endsWithSpace = /\s$/.test(q);
  const prefix = endsWithSpace ? '' : (spans.at(-1)?.value ?? '').toLowerCase();
  const first = spans[0]?.value.toLowerCase();
  const firstArgMode = !first || (spans.length === 1 && !endsWithSpace);

  const filter = (items: readonly SlashPickerItem[]): readonly SlashPickerItem[] =>
    prefix
      ? items.filter(
          (item) => item.kind === 'workflow' && item.label.toLowerCase().startsWith(prefix),
        )
      : items;

  if (firstArgMode) {
    const workflowNames: SlashPickerItem[] = [
      ...(library?.builtin ?? []).map((w) =>
        workflowSuggestion(query, w.name, w.description || 'Built-in workflow'),
      ),
      ...(library?.saved ?? []).map((w) =>
        workflowSuggestion(
          query,
          w.name,
          `Saved workflow${w.source ? ` (${w.source}${w.execution ? `, ${w.execution}` : ''})` : ''}`,
        ),
      ),
    ];
    return filter([
      ...WORKFLOW_SUBCOMMANDS.map((c) =>
        workflowSuggestion(query, c.label, c.description, c.argsHint),
      ),
      ...workflowNames,
    ]);
  }

  const runItems = runs.map((run) =>
    workflowSuggestion(query, run.runId, `${run.status} ${workflowTitle(run)}`),
  );
  const savedItems = (library?.saved ?? []).map((w) =>
    workflowSuggestion(query, w.name, `Saved workflow${w.source ? ` (${w.source})` : ''}`),
  );
  const flag = (label: string, description: string): SlashPickerItem =>
    workflowSuggestion(query, label, description);

  switch (first) {
    case 'runs':
      return filter([flag('--all', 'Show all runs'), flag('--limit', 'Limit run count')]);
    case 'show':
      return filter([flag('--full', 'Show run items and artifacts'), ...runItems]);
    case 'pause':
    case 'resume':
    case 'stop':
    case 'save':
      return filter(runItems);
    case 'delete':
      return filter([
        flag('--force', 'Force-delete a stale run record'),
        flag('--run', 'Treat target as a run'),
        flag('--saved', 'Treat target as a saved workflow'),
        ...runItems,
        ...savedItems,
      ]);
    case 'prune':
      return filter([
        flag('--dry-run', 'Preview candidates only'),
        flag('--keep', 'Keep the newest N terminal runs'),
        flag('--older-than', 'Delete terminal runs older than Nd or Nh'),
      ]);
    case 'rerun':
    case 'rename':
      return filter([...runItems, ...savedItems]);
    case 'revise':
      return filter([
        flag('--replace', 'Replace the saved workflow target'),
        ...runItems,
        ...savedItems,
      ]);
    default:
      return [];
  }
}

const SLASH_ARG_ALIASES: Readonly<Record<string, string>> = {
  a: 'auto',
  am: 'agent-mode',
  bye: 'exit',
  ctx: 'status',
  del: 'delete',
  ext: 'extensions',
  h: 'help',
  hist: 'history',
  info: 'status',
  list: 'sessions',
  ls: 'sessions',
  m: 'model',
  q: 'exit',
  quit: 'exit',
  reason: 'reasoning',
  recovery: 'recover',
  resume: 'load',
  ri: 'repointel',
  rm: 'delete',
  t: 'thinking',
  think: 'thinking',
  '?': 'help',
};

function canonicalSlashArgCommand(command: string): string {
  const lower = command.toLowerCase();
  return SLASH_ARG_ALIASES[lower] ?? lower;
}

function slashArgSuggestion(
  query: string,
  label: string,
  description: string,
  argsHint?: string,
): SlashPickerItem {
  return {
    kind: 'slash-arg',
    label,
    insertText: applySlashArgCompletion(query, label),
    description,
    ...(argsHint ? { argsHint } : {}),
  };
}

function uniqueSlashArgItems(
  items: readonly SlashPickerItem[],
  limit = 80,
): readonly SlashPickerItem[] {
  const seen = new Set<string>();
  const result: SlashPickerItem[] = [];
  for (const item of items) {
    if (item.kind !== 'slash-arg') continue;
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function filterSlashArgItems(
  items: readonly SlashPickerItem[],
  prefix: string,
): readonly SlashPickerItem[] {
  const unique = uniqueSlashArgItems(items);
  if (!prefix) return unique;
  return unique.filter(
    (item) => item.kind === 'slash-arg' && item.label.toLowerCase().startsWith(prefix),
  );
}

function sessionSuggestions(query: string, sessions: readonly SessionMeta[]): SlashPickerItem[] {
  return sessions.map((session) =>
    slashArgSuggestion(
      query,
      session.sessionId,
      session.title || session.projectRoot,
      session.msgCount !== undefined ? `${session.msgCount} msg(s)` : undefined,
    ),
  );
}

function providerSuggestions(
  query: string,
  providers: readonly ProviderInfo[],
  includeModelForms: boolean,
): SlashPickerItem[] {
  const items: SlashPickerItem[] = [];
  for (const provider of providers) {
    items.push(
      slashArgSuggestion(
        query,
        provider.id,
        `${provider.displayName}${provider.configured ? '' : ' (not configured)'}`,
      ),
    );
    if (!includeModelForms) continue;
    for (const model of provider.models ?? []) {
      items.push(
        slashArgSuggestion(query, `${provider.id}/${model}`, `${provider.displayName} model`),
      );
      items.push(
        slashArgSuggestion(query, `/${model}`, `Model on current provider (${provider.id})`),
      );
    }
  }
  return items;
}

function commandHelpSuggestions(
  query: string,
  commands: readonly SlashCommandMeta[],
): SlashPickerItem[] {
  return commands.flatMap((command) => [
    slashArgSuggestion(query, command.name, command.description),
    ...(command.aliases ?? []).map((alias) =>
      slashArgSuggestion(query, alias, `Alias for /${command.name}`),
    ),
  ]);
}

function buildSlashArgSuggestions(
  query: string,
  providers: readonly ProviderInfo[],
  sessions: readonly SessionMeta[],
  commands: readonly SlashCommandMeta[],
): readonly SlashPickerItem[] {
  const q = query.trimStart();
  const match = q.match(/^\/([^\s]+)(?:\s+(.*))?$/);
  if (!match || match[2] === undefined) return [];
  const rawCommand = match[1] ?? '';
  if (rawCommand.includes(':')) return [];
  const command = canonicalSlashArgCommand(rawCommand);
  const rest = match[2] ?? '';
  const spans = scanWorkflowSpans(rest);
  const endsWithSpace = /\s$/.test(q);
  const prefix = endsWithSpace ? '' : (spans.at(-1)?.value ?? '').toLowerCase();
  const first = spans[0]?.value.toLowerCase();
  const argIndex = endsWithSpace ? spans.length : Math.max(0, spans.length - 1);
  const opt = (label: string, description: string, argsHint?: string): SlashPickerItem =>
    slashArgSuggestion(query, label, description, argsHint);

  const staticOptions = (labels: readonly string[]): SlashPickerItem[] =>
    labels.map((label) => opt(label, `/${rawCommand} ${label}`));

  let suggestions: readonly SlashPickerItem[];
  switch (command) {
    case 'help':
      suggestions = commandHelpSuggestions(query, commands);
      break;
    case 'mode':
      suggestions = staticOptions(['plan', 'accept-edits', 'auto']);
      break;
    case 'auto':
      suggestions = staticOptions(['auto']);
      break;
    case 'auto-engine':
      suggestions = staticOptions(['llm', 'rules']);
      break;
    case 'agent-mode':
      suggestions = staticOptions(['ama', 'amaw', 'ama-workflow', 'sa', 'toggle']);
      break;
    case 'reasoning':
      suggestions = staticOptions(['off', 'auto', 'quick', 'balanced', 'deep']);
      break;
    case 'thinking':
      suggestions = staticOptions(['on', 'off', 'auto', 'quick', 'balanced', 'deep']);
      break;
    case 'provider':
      suggestions = providerSuggestions(query, providers, true);
      break;
    case 'model':
      suggestions = [
        opt('default', 'Clear the model override'),
        opt('list', 'List models for the current provider'),
        ...providerSuggestions(query, providers, true),
      ];
      break;
    case 'status':
      suggestions = staticOptions(['workspace', 'worktree', 'runtime', 'peers']);
      break;
    case 'mcp':
      suggestions = staticOptions(['status', 'refresh']);
      break;
    case 'fallback':
      suggestions = [
        opt('status', 'Show the fallback chain'),
        opt('off', 'Disable fallback for this Space process'),
        ...providerSuggestions(query, providers, false),
      ];
      break;
    case 'verifier-log':
    case 'stall-log':
      suggestions = staticOptions(['on', 'off']);
      break;
    case 'goal':
      suggestions = staticOptions([
        'status',
        'pause',
        'resume',
        'complete',
        'blocked',
        'clear',
        'help',
        '--tokens',
      ]);
      break;
    case 'learn':
      suggestions = staticOptions(['pending', 'ledger', 'diff', 'approve', 'reject', 'help']);
      break;
    case 'paste':
      suggestions = staticOptions(['list', 'show', 'help']);
      break;
    case 'memory':
      suggestions = staticOptions([
        'inbox',
        'pending',
        'list',
        'show',
        'approve',
        'reject',
        'curate',
        'open',
        'help',
      ]);
      break;
    case 'review':
      suggestions = [
        opt('--lean', 'Add a minimal-diff review pass'),
        opt('--workflow', 'Ask workflow mode to review changes'),
        opt('base', 'Review against the base branch'),
        opt('sha', 'Review against a specific commit', '<hash>'),
        opt('help', 'Show review help'),
      ];
      break;
    case 'repointel':
      if (first === 'mode' && argIndex >= 1) {
        suggestions = staticOptions(['auto', 'off', 'oss', 'premium-shared', 'premium-native']);
      } else if ((first === 'endpoint' || first === 'bin') && argIndex >= 1) {
        suggestions = staticOptions(['default']);
      } else {
        suggestions = staticOptions(['status', 'mode', 'trace', 'warm', 'endpoint', 'bin']);
      }
      break;
    case 'tree':
      if ((first === 'label' || first === 'unlabel') && argIndex >= 1) {
        suggestions = sessionSuggestions(query, sessions);
      } else {
        suggestions = [
          opt('label', 'Label a tree entry'),
          opt('unlabel', 'Remove a tree label'),
          ...sessionSuggestions(query, sessions),
        ];
      }
      break;
    case 'load':
    case 'delete':
    case 'fork':
    case 'rewind':
      suggestions = sessionSuggestions(query, sessions);
      break;
    case 'extensions':
      if (first === 'sdk' && argIndex >= 1) {
        suggestions = staticOptions(['load']);
      } else {
        suggestions = staticOptions(['status', 'refresh', 'sdk']);
      }
      break;
    case 'recover':
      suggestions = staticOptions(['seed', 'prompt', 'candidate', 'help']);
      break;
    case 'skills':
    case 'skill':
      suggestions = staticOptions(['pending', 'ledger']);
      break;
    case 'sessions':
    case 'save':
    case 'reload':
    case 'exit':
      suggestions = [];
      break;
    default:
      suggestions = [];
  }
  return filterSlashArgItems(suggestions, prefix);
}

async function loadCommandsOnce(): Promise<SlashCommandMeta[]> {
  if (cachedCommands) return cachedCommands;
  if (!window.kodaxSpace) return [];
  const result = await window.kodaxSpace.invoke('slash.discover', undefined);
  if (!result.ok) return [];
  cachedCommands = [...result.data.commands];
  return cachedCommands;
}

async function loadSkillsForProject(
  projectRoot: string,
  forceReload: boolean,
): Promise<SkillMeta[]> {
  if (!forceReload && cachedSkills && cachedSkills.projectRoot === projectRoot) {
    return cachedSkills.list;
  }
  if (!window.kodaxSpace) return [];
  // v0.1.10 fix: 用户跑 skill-creator 生成新 skill 后, 之前要重启 Space 才能 / 补全;
  // 现在 popover mount 都 forceReload, IPC main 端清 wrapper cache 重 scan 磁盘。
  const result = await window.kodaxSpace.invoke('skill.discover', {
    projectRoot,
    ...(forceReload ? { forceReload: true } : {}),
  });
  if (!result.ok) {
    cachedSkills = { projectRoot, list: [] };
    return [];
  }
  cachedSkills = { projectRoot, list: [...result.data.skills] };
  return cachedSkills.list;
}

/**
 * 测试用：清空缓存让下一次重新拉。
 * 生产构建 no-op，避免运行期被误调导致 popover 重新走一次 IPC discover。
 */
export function _resetSlashCacheForTesting(): void {
  if (import.meta.env.PROD) return;
  cachedCommands = null;
  cachedSkills = null;
}

export function SlashCommandPopover(props: SlashCommandPopoverProps): JSX.Element | null {
  const { t } = useI18n();
  const { onPick, registerKeyHandler } = props;
  const [items, setItems] = useState<readonly SlashPickerItem[]>([]);
  const [workflowLibrary, setWorkflowLibrary] = useState<WorkflowLibraryLite | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<readonly WorkflowRunT[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const projectRoot = useAppStore((s) => s.currentProjectPath);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const providers = useAppStore((s) => s.providers);
  const sessions = useAppStore((s) => s.sessions);
  const listRef = useRef<HTMLDivElement>(null);
  const workflowMode = /^\/workflow(?:\s|$)/i.test(props.query.trimStart());
  const slashArgMode = !workflowMode && /^\/[^\s]+\s/.test(props.query.trimStart());

  // 启动时拉两份：slash + skills，合成 unified picker list（按 name 字典序）
  useEffect(() => {
    if (!projectRoot) {
      setItems([]);
      return;
    }
    let cancelled = false;
    // v0.1.10 fix: forceReload=true 让用户跑 skill-creator 后立即可见 (跳 60s cache TTL)。
    // Popover mount 是用户主动按 `/` 触发, 每次 force scan 用户体感无延迟 (SDK discover ~10ms)。
    void Promise.all([loadCommandsOnce(), loadSkillsForProject(projectRoot, true)]).then(
      ([cmds, skills]) => {
        if (cancelled) return;
        const merged: SlashPickerItem[] = [
          ...cmds.map((c): SlashPickerItem => ({ kind: 'slash', meta: c })),
          ...skills.map(
            (s): SlashPickerItem => ({
              kind: 'skill',
              meta: s,
              displayName: safeSkillSlashText(s.name, cmds),
              insertText: skillSlashInsertText(s.name, cmds),
            }),
          ),
        ];
        merged.sort((a, b) => pickerItemName(a).localeCompare(pickerItemName(b)));
        setItems(merged);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    if (!workflowMode || !projectRoot || !window.kodaxSpace) {
      setWorkflowLibrary(null);
      setWorkflowRuns([]);
      return;
    }
    let cancelled = false;
    const libraryPromise = window.kodaxSpace.invoke('workflow.library', { projectRoot });
    const runsPromise = currentSessionId
      ? window.kodaxSpace.invoke('workflow.list', { sessionId: currentSessionId })
      : Promise.resolve(null);
    void Promise.all([libraryPromise, runsPromise]).then(([libraryResult, runsResult]) => {
      if (cancelled) return;
      setWorkflowLibrary(libraryResult.ok ? libraryResult.data : null);
      setWorkflowRuns(runsResult?.ok ? runsResult.data.runs : []);
    });
    return () => {
      cancelled = true;
    };
  }, [workflowMode, projectRoot, currentSessionId]);

  // query 变化重置选中索引
  useEffect(() => {
    setSelectedIdx(0);
  }, [props.query]);

  // KodaX skills can be invoked directly as `/<name>`.
  // Filter 模式两条:
  //   - 用户输入 `/skill:<前缀>` → 兼容旧 namespace, 只列 skills
  //   - 用户输入 `/<前缀>`        → 同时列 slash commands + skills (前缀匹配 name)
  // 默认补全和展示使用 `/<name>`; 和 slash command 重名时回退 `/skill:<name>` 防止误执行。
  const queryLower = props.query.toLowerCase();
  const skillNamespaceMatch = queryLower.match(/^\/skill:(.*)$/);
  const skillOnlyMode = skillNamespaceMatch !== null;
  const prefix = skillOnlyMode ? skillNamespaceMatch[1]! : queryLower.replace(/^\//, '');
  const commandMetas = items.flatMap((item) => (item.kind === 'slash' ? [item.meta] : []));
  const filtered = workflowMode
    ? buildWorkflowSuggestions(props.query, workflowLibrary, workflowRuns)
    : slashArgMode
      ? buildSlashArgSuggestions(props.query, providers, sessions, commandMetas)
      : items.filter((c) => {
          if (skillOnlyMode && c.kind !== 'skill') return false;
          if (c.kind === 'workflow') return false;
          if (c.kind === 'slash-arg') return false;
          if (c.kind === 'slash') {
            return (
              c.meta.name.startsWith(prefix) ||
              (c.meta.aliases ?? []).some((alias) => alias.startsWith(prefix))
            );
          }
          return c.meta.name.startsWith(prefix);
        });

  // 上下键 / Tab / Esc 键盘处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent): boolean => {
      if (filtered.length === 0) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
        return true;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return true;
      } else if (e.key === 'Tab') {
        // Tab accepts completion. Enter is reserved for composer send; Shift+Enter remains textarea newline.
        const item = filtered[selectedIdx];
        if (item) {
          e.preventDefault();
          onPick(item);
          return true;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onPick(null);
        return true;
      }
      return false;
    };
    registerKeyHandler?.(onKey);
    return () => registerKeyHandler?.(null);
  }, [filtered, selectedIdx, onPick, registerKeyHandler]);

  // 选中项 scroll-into-view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLDivElement>(`[data-slash-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!projectRoot) return null;
  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-3 right-3 bottom-full mb-1 max-h-64 overflow-y-auto bg-surface-4 border border-border-default rounded-lg shadow-xl text-xs z-40"
      role="listbox"
      aria-label={t('slash.commandsAndSkills')}
    >
      {filtered.map((item, idx) => {
        const selected = idx === selectedIdx;
        const name =
          item.kind === 'workflow' || item.kind === 'slash-arg' ? item.label : item.meta.name;
        const description =
          item.kind === 'workflow' || item.kind === 'slash-arg'
            ? item.description
            : item.meta.description;
        const argsHint =
          item.kind === 'workflow' || item.kind === 'slash-arg'
            ? item.argsHint
            : item.kind === 'slash'
              ? item.meta.argsHint
              : item.meta.argumentHint;
        const displayName =
          item.kind === 'workflow' || item.kind === 'slash-arg'
            ? item.label
            : item.kind === 'skill'
              ? item.displayName
              : `/${item.meta.name}`;
        return (
          <div
            key={`${item.kind}:${name}`}
            data-slash-idx={idx}
            role="option"
            aria-selected={selected}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(item);
            }}
            onMouseEnter={() => setSelectedIdx(idx)}
            className={`px-3 py-1.5 flex items-center gap-3 cursor-pointer ${
              selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
            }`}
          >
            <span
              className={`font-mono min-w-[140px] ${
                item.kind === 'skill'
                  ? 'text-run'
                  : item.kind === 'workflow' || item.kind === 'slash-arg'
                    ? 'text-accent'
                    : 'text-warn'
              }`}
            >
              {/* Skill names may use /skill:name when needed to avoid command conflicts. */}
              {displayName}
            </span>
            {argsHint && <span className="text-[11px] text-fg-faint font-mono">{argsHint}</span>}
            <span className="text-fg-muted truncate">{description}</span>
            <span className="ml-auto text-[9px] text-fg-faint uppercase">
              {item.kind === 'workflow'
                ? 'workflow'
                : item.kind === 'slash-arg'
                  ? 'arg'
                  : item.kind === 'slash'
                    ? item.meta.source === 'user'
                      ? 'user'
                      : ''
                    : item.meta.source}
            </span>
          </div>
        );
      })}
    </div>
  );
}

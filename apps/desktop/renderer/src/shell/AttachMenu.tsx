// AttachMenu — alpha.1
//
// Claude Desktop 底部输入框旁"+"号按钮 popup（截图 2）：
//
//   📎 Add files or photos
//   📁 Add folder
//   ⌗ Slash commands
//   ⚙ Connectors ›
//   🧩 Skills ›
//
// alpha.1 范围：
//   - Add files：native picker 选文件 → 把 path 注入到 prompt 末尾作为 inline 引用
//   - Add folder：project.openDialog → 切到所选目录（开新 project）
//   - Slash commands：弹个简单的 list，点击插入到 prompt
//   - Connectors：拉 mcp.discover 显示当前 project 的 MCP servers（只读）
//   - Skills：拉 skill.discover 显示已注册 skills（点击插入 /<name> 到 prompt）
//
// Discover (skills / mcp servers / agents) 走 projectRoot —— 不再要求 live SDK
// session：用户从 Recents 恢复历史会话时，UI 有 sessionId 但 SDK 没 spin up live
// session；强制 sessionId 会让 handler 报 "session not found"。projectRoot 来自
// currentProjectPath，永远可用。

import { useEffect, useState } from 'react';
import {
  Paperclip,
  FolderPlus,
  Slash,
  Plug,
  Puzzle,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import type { McpServerMeta, SkillMeta, SlashCommandMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { Caret } from '../components/Caret.js';
import { useI18n } from '../i18n/I18nProvider.js';
import type { MessageKey } from '../i18n/messages.js';
import { safeSkillSlashText, skillSlashInsertText } from './skillSlash.js';

interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  onInsertText: (text: string) => void;
}

const SLASH_COMMANDS: readonly { cmd: string; descKey: MessageKey }[] = [
  { cmd: '/help', descKey: 'attach.slash.help' },
  { cmd: '/clear', descKey: 'attach.slash.clear' },
  { cmd: '/mode', descKey: 'attach.slash.mode' },
  { cmd: '/model', descKey: 'attach.slash.model' },
];

type SubMenu = 'root' | 'slash' | 'connectors' | 'skills';

export function AttachMenu({ open, onClose, onInsertText }: AttachMenuProps): JSX.Element | null {
  const { t } = useI18n();
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [sub, setSub] = useState<SubMenu>('root');
  const [mcpServers, setMcpServers] = useState<readonly McpServerMeta[] | null>(null);
  const [skills, setSkills] = useState<readonly SkillMeta[] | null>(null);
  const [slashCommands, setSlashCommands] = useState<readonly SlashCommandMeta[]>([]);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSub('root');
      setMcpServers(null);
      setSkills(null);
      setSlashCommands([]);
      setDiscoverErr(null);
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (sub === 'root') onClose();
        else setSub('root');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, sub]);

  if (!open) return null;

  async function addFiles(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      onInsertText(`@${r.data.path}`);
    }
    onClose();
  }

  async function addFolder(): Promise<void> {
    if (!window.kodaxSpace) return;
    const r = await window.kodaxSpace.invoke('project.openDialog', undefined);
    if (r.ok && r.data.path !== null) {
      // 切到所选目录作为当前 project — project.list 会刷新
      setCurrentProject(r.data.path);
      const listR = await window.kodaxSpace.invoke('project.list', undefined);
      if (listR.ok) useAppStore.getState().setProjects(listR.data.projects);
    }
    onClose();
  }

  async function loadConnectors(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!currentProjectPath) {
      setDiscoverErr(t('attach.openProjectForMcp'));
      setSub('connectors');
      return;
    }
    setSub('connectors');
    setDiscoverErr(null);
    const r = await window.kodaxSpace.invoke('mcp.discover', { projectRoot: currentProjectPath });
    if (r.ok) {
      setMcpServers(r.data.servers);
      if (r.data.errors.length > 0) {
        setDiscoverErr(t('attach.configErrors', { count: r.data.errors.length }));
      }
    } else {
      setDiscoverErr(r.error?.message ?? t('attach.loadMcpFailed'));
    }
  }

  async function loadSkills(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!currentProjectPath) {
      setDiscoverErr(t('attach.openProjectForSkills'));
      setSub('skills');
      return;
    }
    setSub('skills');
    setDiscoverErr(null);
    const [skillsResult, commandsResult] = await Promise.all([
      window.kodaxSpace.invoke('skill.discover', { projectRoot: currentProjectPath }),
      window.kodaxSpace.invoke('slash.discover', undefined),
    ]);
    setSlashCommands(commandsResult.ok ? commandsResult.data.commands : []);
    if (skillsResult.ok) {
      setSkills(skillsResult.data.skills);
    } else {
      setDiscoverErr(skillsResult.error?.message ?? t('attach.loadSkillsFailed'));
    }
  }

  if (sub === 'slash') {
    return (
      <SubMenuFrame title={t('attach.slashCommands')} onBack={() => setSub('root')}>
        {SLASH_COMMANDS.map((s) => (
          <button
            key={s.cmd}
            type="button"
            onClick={() => {
              onInsertText(s.cmd + ' ');
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hover-bg flex items-center gap-2 text-xs"
          >
            <code className="text-ok font-mono">{s.cmd}</code>
            <span className="text-fg-muted truncate">{t(s.descKey)}</span>
          </button>
        ))}
        <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted">
          {t('attach.slashHint')}
        </div>
      </SubMenuFrame>
    );
  }

  if (sub === 'connectors') {
    return (
      <SubMenuFrame title={t('attach.connectorsMcp')} onBack={() => setSub('root')}>
        {discoverErr && <div className="px-3 py-1 text-[11px] text-warn">{discoverErr}</div>}
        {mcpServers === null && !discoverErr && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">{t('attach.loading')}</div>
        )}
        {mcpServers !== null && mcpServers.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">
            {t('attach.noMcp')}
          </div>
        )}
        {mcpServers?.map((s) => (
          <div
            key={`${s.source}:${s.name}`}
            className="px-3 py-1.5 hover:bg-hover-bg text-xs flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-ok flex-shrink-0" aria-hidden />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-[11px] text-fg-muted font-mono">{s.transport}</span>
            <span className="text-[11px] text-fg-faint">{s.source}</span>
          </div>
        ))}
      </SubMenuFrame>
    );
  }

  if (sub === 'skills') {
    return (
      <SubMenuFrame title={t('attach.skills')} onBack={() => setSub('root')}>
        {discoverErr && <div className="px-3 py-1 text-[11px] text-warn">{discoverErr}</div>}
        {skills === null && !discoverErr && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">{t('attach.loading')}</div>
        )}
        {skills !== null && skills.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">{t('attach.noSkills')}</div>
        )}
        {skills?.map((sk) => (
          <button
            key={`${sk.source}:${sk.name}`}
            type="button"
            onClick={() => {
              // Insert a skill trigger, falling back to /skill:name for command-name conflicts.
              onInsertText(skillSlashInsertText(sk.name, slashCommands));
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hover-bg flex items-center gap-2 text-xs"
            title={`${sk.path} (${sk.source})`}
          >
            <code className="text-ok font-mono">{safeSkillSlashText(sk.name, slashCommands)}</code>
            <span className="text-fg-muted truncate flex-1">{sk.description}</span>
            <span className="text-[11px] text-fg-faint">{sk.source}</span>
          </button>
        ))}
      </SubMenuFrame>
    );
  }

  return (
    <div
      className="absolute left-0 bottom-full mb-1 w-60 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 text-xs z-50"
      onMouseLeave={onClose}
    >
      <AttachRow Icon={Paperclip} label={t('attach.addFiles')} onClick={() => void addFiles()} />
      <AttachRow Icon={FolderPlus} label={t('attach.addFolder')} onClick={() => void addFolder()} />
      <AttachRow Icon={Slash} label={t('attach.slashCommands')} onClick={() => setSub('slash')} chevron />
      <AttachRow Icon={Plug} label={t('attach.connectors')} onClick={() => void loadConnectors()} chevron />
      <AttachRow Icon={Puzzle} label={t('attach.skills')} onClick={() => void loadSkills()} chevron />
    </div>
  );
}

function SubMenuFrame({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="absolute left-0 bottom-full mb-1 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 z-50 max-h-80 overflow-y-auto">
      <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-fg-muted flex items-center gap-2 sticky top-0 bg-surface-2">
        <button
          type="button"
          onClick={onBack}
          className="hover:text-fg-secondary inline-flex items-center"
          aria-label={t('attach.back')}
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
        </button>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function AttachRow({
  Icon,
  label,
  onClick,
  disabled,
  chevron,
  hint,
}: {
  Icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
        disabled ? 'text-fg-faint cursor-not-allowed' : 'text-fg-secondary hover:bg-hover-bg'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{label}</span>
      {chevron && <Caret open={false} className="text-fg-faint" />}
    </button>
  );
}

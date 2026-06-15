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
import type { McpServerMeta, SkillMeta } from '@kodax-space/space-ipc-schema';
import { useAppStore } from '../store/appStore.js';
import { Caret } from '../components/Caret.js';

interface AttachMenuProps {
  open: boolean;
  onClose: () => void;
  onInsertText: (text: string) => void;
}

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear conversation context (new session)' },
  { cmd: '/mode', desc: 'Cycle permission mode' },
  { cmd: '/model', desc: 'Switch model' },
];

type SubMenu = 'root' | 'slash' | 'connectors' | 'skills';

export function AttachMenu({ open, onClose, onInsertText }: AttachMenuProps): JSX.Element | null {
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [sub, setSub] = useState<SubMenu>('root');
  const [mcpServers, setMcpServers] = useState<readonly McpServerMeta[] | null>(null);
  const [skills, setSkills] = useState<readonly SkillMeta[] | null>(null);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSub('root');
      setMcpServers(null);
      setSkills(null);
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
      setDiscoverErr('Open a project first to see its MCP servers.');
      setSub('connectors');
      return;
    }
    setSub('connectors');
    setDiscoverErr(null);
    const r = await window.kodaxSpace.invoke('mcp.discover', { projectRoot: currentProjectPath });
    if (r.ok) {
      setMcpServers(r.data.servers);
      if (r.data.errors.length > 0) {
        setDiscoverErr(`${r.data.errors.length} config errors — check console`);
      }
    } else {
      setDiscoverErr(r.error?.message ?? 'failed to load MCP servers');
    }
  }

  async function loadSkills(): Promise<void> {
    if (!window.kodaxSpace) return;
    if (!currentProjectPath) {
      setDiscoverErr('Open a project first to see its skills.');
      setSub('skills');
      return;
    }
    setSub('skills');
    setDiscoverErr(null);
    const r = await window.kodaxSpace.invoke('skill.discover', { projectRoot: currentProjectPath });
    if (r.ok) {
      setSkills(r.data.skills);
    } else {
      setDiscoverErr(r.error?.message ?? 'failed to load skills');
    }
  }

  if (sub === 'slash') {
    return (
      <SubMenuFrame title="Slash commands" onBack={() => setSub('root')}>
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
            <span className="text-fg-muted truncate">{s.desc}</span>
          </button>
        ))}
        <div className="border-t border-border-default mt-1 pt-1 px-3 py-1 text-[11px] text-fg-muted">
          Use `/` in textarea for full skill + command picker
        </div>
      </SubMenuFrame>
    );
  }

  if (sub === 'connectors') {
    return (
      <SubMenuFrame title="Connectors (MCP)" onBack={() => setSub('root')}>
        {discoverErr && <div className="px-3 py-1 text-[11px] text-warn">{discoverErr}</div>}
        {mcpServers === null && !discoverErr && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">Loading…</div>
        )}
        {mcpServers !== null && mcpServers.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">
            No MCP servers configured. Edit ~/.kodax/config.json to add.
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
      <SubMenuFrame title="Skills" onBack={() => setSub('root')}>
        {discoverErr && <div className="px-3 py-1 text-[11px] text-warn">{discoverErr}</div>}
        {skills === null && !discoverErr && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">Loading…</div>
        )}
        {skills !== null && skills.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-fg-muted">No skills registered yet.</div>
        )}
        {skills?.map((sk) => (
          <button
            key={`${sk.source}:${sk.name}`}
            type="button"
            onClick={() => {
              // 插 `/skill:<name> ` —— 与 `/` 补全弹窗 + KodaX REPL namespace 一致
              // （handleSend 认 `/skill:` 前缀直接走 invokeSkill）。带尾空格让用户接着补 args。
              onInsertText(`/skill:${sk.name} `);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-hover-bg flex items-center gap-2 text-xs"
            title={`${sk.path} (${sk.source})`}
          >
            <code className="text-ok font-mono">/skill:{sk.name}</code>
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
      <AttachRow Icon={Paperclip} label="Add files or photos" onClick={() => void addFiles()} />
      <AttachRow Icon={FolderPlus} label="Add folder" onClick={() => void addFolder()} />
      <AttachRow Icon={Slash} label="Slash commands" onClick={() => setSub('slash')} chevron />
      <AttachRow Icon={Plug} label="Connectors" onClick={() => void loadConnectors()} chevron />
      <AttachRow Icon={Puzzle} label="Skills" onClick={() => void loadSkills()} chevron />
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
  return (
    <div className="absolute left-0 bottom-full mb-1 w-72 bg-surface-4 border border-border-default rounded-lg shadow-xl py-1 z-50 max-h-80 overflow-y-auto">
      <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-fg-muted flex items-center gap-2 sticky top-0 bg-surface-2">
        <button
          type="button"
          onClick={onBack}
          className="hover:text-fg-secondary inline-flex items-center"
          aria-label="Back"
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

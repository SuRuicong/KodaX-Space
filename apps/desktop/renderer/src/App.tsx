// App — FEATURE_005 起的主壳层。
//
// 布局：
//   ┌─── header ────────────────────────────────┐
//   │ 左抽屉 (240px) │ EventStream (主区)          │
//   │  ProjectPicker │  current session 标头        │
//   │  SessionList   │  事件流                      │
//   │                │  prompt 输入                 │
//   └─── footer ────────────────────────────────┘
//
// 顶层负责：
//   - 一次性订阅 push channel `session.event`，按 sessionId 路由进 store
//   - 取 space.version 显示在 header
//   - 渲染左抽屉 + 主区
//
// 不在这里：
//   - 业务状态——全部 Zustand store
//   - feature 逻辑——拆进 features/{project,session}/*

import { useEffect, useRef, useState } from 'react';
import type { SpaceVersionOutput } from '@kodax-space/space-ipc-schema';
import { useAppStore } from './store/appStore.js';
import { ProjectPicker } from './features/project/ProjectPicker.js';
import { SessionList } from './features/session/SessionList.js';
import { EventStream } from './features/session/EventStream.js';
import { PermissionModal } from './features/permission/PermissionModal.js';
import { AskUserModal } from './features/ask-user/AskUserModal.js';
import { ProviderSettings } from './features/provider/ProviderSettings.js';
import { FilePanel } from './features/code/FilePanel.js';
import { Shell } from './shell/Shell.js';

// alpha.1: Claude Desktop 风 shell 已成为默认 UI。
// 修复了 React #185 无限渲染循环（ConversationStreamV2 / ContextWindowIndicator / SessionMenu 里
// useAppStore selector `?? []` literal 每 render 新引用触发 zustand subscribe loop —— 改成 module-level
// EMPTY_EVENTS / EMPTY_USER_MESSAGES 稳定引用）。VITE_USE_NEW_SHELL=0 显式回退到老 layout。
// 注：init useEffect 在两种 shell 下都需要跑（拉 version / providers / 订阅事件流），所以保持在 App 顶层。
const USE_NEW_SHELL = import.meta.env.VITE_USE_NEW_SHELL !== '0';

export default function App(): JSX.Element {
  const [version, setVersion] = useState<SpaceVersionOutput | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const appendEvent = useAppStore((s) => s.appendEvent);
  const enqueuePermission = useAppStore((s) => s.enqueuePermission);
  const dequeuePermission = useAppStore((s) => s.dequeuePermission);
  const enqueueAskUser = useAppStore((s) => s.enqueueAskUser);
  const dequeueAskUser = useAppStore((s) => s.dequeueAskUser);
  const setProviders = useAppStore((s) => s.setProviders);
  const setKodaxDefaults = useAppStore((s) => s.setKodaxDefaults);
  const providers = useAppStore((s) => s.providers);
  const defaultProviderId = useAppStore((s) => s.defaultProviderId);
  const unsubsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const bridge = window.kodaxSpace;
    if (!bridge) return;

    // 启动期一次性自检 + 订阅事件流
    bridge.invoke('space.version', undefined).then((result) => {
      if (result.ok) setVersion(result.data);
    });

    // FEATURE_004 启动时拉一次 provider 列表（main 已经把 keychain 中的 key 注入 env）
    bridge.invoke('provider.list', undefined).then((result) => {
      if (result.ok) {
        setProviders(result.data.providers, result.data.defaultProviderId, result.data.keychainBackend);
      }
    });

    // v0.1.6 cleanup: 同时拉 ~/.kodax/config.json 的默认值（provider / model / thinking 等）
    // Space defaultProviderId 为 null 时 SessionList 会 fallback 到这里的 provider；
    // session 创建时也用这里的 reasoningMode / model 作为初值。失败静默 — 用 Space 自己的 default。
    bridge.invoke('kodax.getDefaults', {}).then((result) => {
      if (result.ok) {
        setKodaxDefaults(result.data);
      }
    });

    // 启动期：把磁盘的 recent projects 列表载入 store，让 ChipBar 📁 下拉看到上次的项目。
    // 新 Shell 不渲染旧 ProjectPicker 组件，所以那个 mount-time project.list 路径不会跑——
    // 必须在 App 顶层启动时显式拉一次。还原"打开过的 dir 没保留"的 bug 根因。
    void bridge.invoke('project.list', undefined).then((result) => {
      if (result.ok) useAppStore.getState().setProjects(result.data.projects);
    });

    // 启动期：若 currentProjectPath 仍 null，从 settings.get 拉默认 workspace 自动设上。
    // main 端 ensureWorkspaceExists 保证 ~/kodax_workspace 已 mkdir。这样新用户首次启动
    // 不必先点 Open folder 才能用 — 类似 Claude Code 的 "立刻可用" 体验。
    void bridge.invoke('settings.get', {}).then(async (result) => {
      if (!result.ok) return;
      const { defaultWorkspace } = result.data;
      const cur = useAppStore.getState().currentProjectPath;
      if (cur) return; // 用户已经选了 project（recent picker 或 dialog），不覆盖
      useAppStore.getState().setCurrentProject(defaultWorkspace);
      // 同时加进 recent list，让侧栏 ProjectPicker 看得到
      await bridge.invoke('project.recent.add', { path: defaultWorkspace }).catch(() => {});
      // recent.add 后再刷一次 list — 新条目应当立即出现在 ChipBar 📁 下拉里
      const listR = await bridge.invoke('project.list', undefined).catch(() => null);
      if (listR && listR.ok) useAppStore.getState().setProjects(listR.data.projects);
    });

    // 全局 session.event 订阅——所有 session 共用这个监听，store 按 sessionId 路由
    unsubsRef.current.push(
      bridge.on('session.event', (event) => {
        appendEvent(event);
      }),
    );

    // F007: permission ask-and-wait — push 进队列，modal 渲染队列头
    unsubsRef.current.push(
      bridge.on('permission.request', (payload) => {
        enqueuePermission(payload);
      }),
    );

    // main 主动撤回（超时 / session 取消 / 关闭）— renderer 同步 dequeue 关弹窗
    unsubsRef.current.push(
      bridge.on('permission.cancelled', (payload) => {
        dequeuePermission(payload.reqId);
      }),
    );

    // FEATURE_032: askUser ask-and-wait — push 进 askUser 队列，AskUserModal 渲染队列头
    unsubsRef.current.push(
      bridge.on('askUser.request', (payload) => {
        enqueueAskUser(payload);
      }),
    );
    unsubsRef.current.push(
      bridge.on('askUser.cancelled', (payload) => {
        dequeueAskUser(payload.reqId);
      }),
    );

    return () => {
      for (const u of unsubsRef.current) u();
      unsubsRef.current = [];
    };
  }, [
    appendEvent,
    enqueuePermission,
    dequeuePermission,
    enqueueAskUser,
    dequeueAskUser,
    setProviders,
    setKodaxDefaults,
  ]);

  // Esc 关 settings 面板
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings]);

  const configuredCount = providers.filter((p) => p.configured).length;
  const defaultProvider = providers.find((p) => p.id === defaultProviderId);

  // alpha.1: 新 Shell 接管整个 layout，旧 layout 保留以 fallback 验证。
  // Settings overlay 仍 hoist 在这里（Shell 内部不重复实现）。
  //
  // **注意 (F032 review)**：PermissionModal / AskUserModal 由 Shell 内部 mount，本分支 return
  // 之前的代码不应当再 mount 一次——否则两套 modal 共享 store queue 会双重渲染 + 双重键盘
  // 监听。下方 USE_NEW_SHELL=false 分支才走 root-level mount。
  if (USE_NEW_SHELL) {
    return (
      <>
        <Shell />
        {showSettings && <ProviderSettings onClose={() => setShowSettings(false)} />}
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
        <h1 className="text-sm font-semibold">KodaX Space</h1>
        <span className="text-xs text-zinc-500 font-mono">
          v{version?.spaceVersion ?? '?.?.?'}
        </span>
        <button
          type="button"
          onClick={() => setShowFiles((v) => !v)}
          className={`ml-auto px-2 py-1 text-[11px] rounded border border-zinc-800 flex items-center gap-1.5 ${
            showFiles ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          }`}
          title="Toggle file panel"
        >
          <span aria-hidden>📁</span>
          <span>Files</span>
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="px-2 py-1 text-[11px] rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1.5"
          title="Provider settings"
        >
          <span aria-hidden>⚙</span>
          <span className="font-mono">
            {defaultProvider ? defaultProvider.displayName : `${configuredCount}/${providers.length} providers`}
          </span>
        </button>
        <span className="text-[10px] text-zinc-600 font-mono">
          {version
            ? `electron ${version.electronVersion} · chromium ${version.chromeVersion}`
            : 'loading…'}
        </span>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-60 flex flex-col border-r border-zinc-800 flex-shrink-0">
          <ProjectPicker />
          <SessionList />
        </aside>
        <EventStream />
        {showFiles && <FilePanel />}
      </div>

      <footer className="border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-600 flex justify-between flex-shrink-0">
        <span>
          FEATURE_004 · Mock adapter · docs:{' '}
          <code className="font-mono text-zinc-500">docs/HLD.md</code>
        </span>
        <span>{version?.platform ?? ''}</span>
      </footer>

      <PermissionModal />
      <AskUserModal />
      {showSettings && <ProviderSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

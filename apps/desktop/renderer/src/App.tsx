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
import { Folder, Settings } from 'lucide-react';
import type { SpaceVersionOutput } from '@kodax-space/space-ipc-schema';
import { useAppStore } from './store/appStore.js';
import { ProjectPicker } from './features/project/ProjectPicker.js';
import { SessionList } from './features/session/SessionList.js';
import { EventStream } from './features/session/EventStream.js';
import { PermissionModal } from './features/permission/PermissionModal.js';
import { AskUserModal } from './features/ask-user/AskUserModal.js';
import { SettingsModal } from './features/settings/SettingsModal.js';
import { QuickAskPopover } from './features/quick-ask/QuickAskPopover.js';
import { useSessionCompleteNotification } from './features/notifications/useSessionCompleteNotification.js';
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
  // F018 Quick Ask popover —— Cmd/Ctrl+K toggles
  const [showQuickAsk, setShowQuickAsk] = useState(false);
  const appendEvent = useAppStore((s) => s.appendEvent);
  const enqueuePermission = useAppStore((s) => s.enqueuePermission);
  const dequeuePermission = useAppStore((s) => s.dequeuePermission);
  const enqueueAskUser = useAppStore((s) => s.enqueueAskUser);
  const dequeueAskUser = useAppStore((s) => s.dequeueAskUser);
  const setProviders = useAppStore((s) => s.setProviders);
  const setKodaxDefaults = useAppStore((s) => s.setKodaxDefaults);
  const setQueueState = useAppStore((s) => s.setQueueState);
  const upsertWorkflowRun = useAppStore((s) => s.upsertWorkflowRun);
  const seedWorkflowRuns = useAppStore((s) => s.seedWorkflowRuns);
  const appendWorkflowActivity = useAppStore((s) => s.appendWorkflowActivity);
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen);
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
        setProviders(
          result.data.providers,
          result.data.defaultProviderId,
          result.data.keychainBackend,
        );
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

    // 启动期项目恢复 — 优先级：
    //   1. zustand store 已有 currentProjectPath（localStorage 持久化的 → store init 时就填上了）
    //   2. project.list 里 lastUsedAt 最新的 recent project（用户上次开过的真实目录）
    //   3. settings.defaultWorkspace 兜底（首次启动新用户）
    //
    // 之前直接走 defaultWorkspace，等同于"每次启动都打开默认 workspace"——用户在
    // KodaX-Space / 别的项目里干完活退出，下次开 Space 又跳回默认目录，体验差。
    // 现在按"最近用的"恢复，跟 VSCode / Claude Desktop / Cursor 等 IDE 一致。
    void (async () => {
      const listR = await bridge.invoke('project.list', undefined).catch(() => null);
      const projects = listR && listR.ok ? listR.data.projects : [];
      useAppStore.getState().setProjects(projects);

      // 已经有 currentProjectPath（localStorage 恢复 / 用户已操作）→ 不覆盖
      if (useAppStore.getState().currentProjectPath) return;

      // 优先用 recent 里 lastUsedAt 最新的
      if (projects.length > 0) {
        const mostRecent = projects.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a));
        useAppStore.getState().setCurrentProject(mostRecent.path);
        return;
      }

      // 一个 recent 都没有 → 真"首次启动"，落到 defaultWorkspace
      const settingsR = await bridge.invoke('settings.get', {}).catch(() => null);
      if (!settingsR || !settingsR.ok) return;
      const { defaultWorkspace } = settingsR.data;
      useAppStore.getState().setCurrentProject(defaultWorkspace);
      await bridge.invoke('project.recent.add', { path: defaultWorkspace }).catch(() => {});
      const refreshR = await bridge.invoke('project.list', undefined).catch(() => null);
      if (refreshR && refreshR.ok) useAppStore.getState().setProjects(refreshR.data.projects);
    })();

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

    // KodaX SDK MessageQueue (FEATURE_115/159) — 启动期拉一次,然后订阅 main 推的实时变更。
    // SDK queue 当前 mid-turn drain / subagent task-notification / REPL 等场景会写;
    // Space 这里只读 + 显示,enqueue/dequeue 由 SDK 自己管。
    bridge.invoke('kodax.queueGet', {}).then((r) => {
      if (r.ok) setQueueState(r.data.messages, r.data.totalSize);
    });
    unsubsRef.current.push(
      bridge.on('kodax.queueChanged', (payload) => {
        setQueueState(payload.snapshot, payload.totalSize);
      }),
    );

    // F060 Workflow Harness — 启动期播种已知 run，然后订阅 SDK 进程事件实时流（按 runId 覆盖式 upsert）。
    bridge
      .invoke('workflow.list', undefined)
      .then((r) => {
        if (r.ok) seedWorkflowRuns(r.data.runs);
      })
      .catch(() => {
        /* best-effort 播种；失败由后续实时事件补齐 */
      });
    unsubsRef.current.push(
      bridge.on('workflow.event', (payload) => {
        upsertWorkflowRun(payload);
        if (
          payload.type === 'workflow_started' &&
          payload.sessionId !== undefined &&
          payload.surface !== 'partner' &&
          useAppStore.getState().currentSessionId === payload.sessionId
        ) {
          setRightSidebarOpen(true);
        }
      }),
    );
    // F065 子 agent 活动遥测——归到 run 的有界活动桶（不进主 transcript）。
    unsubsRef.current.push(
      bridge.on('workflow.activity', (payload) => {
        appendWorkflowActivity(payload);
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
    setQueueState,
    upsertWorkflowRun,
    seedWorkflowRuns,
    appendWorkflowActivity,
    setRightSidebarOpen,
  ]);

  // (Esc 关 settings 面板已下放到 SettingsModal 自己 own —— 见 features/settings/SettingsModal.tsx)

  // OC-11: SystemNotice 的 "Provider settings" 按钮派发 CustomEvent —— 这里接住
  // 打开 Settings 模态，让 auth/quota 错误一键能跳转到改 key 的界面。
  useEffect(() => {
    const open = (): void => setShowSettings(true);
    window.addEventListener('kodax-space.open-provider-settings', open);
    return () => window.removeEventListener('kodax-space.open-provider-settings', open);
  }, []);

  // F018 Quick Ask global shortcut: Cmd+K (macOS) / Ctrl+K (others)
  // 跟 VSCode Quick Open / Slack / Linear 一致的 muscle memory。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowQuickAsk((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // F020 long-task complete OS notification — 在前台时不通知，>60s 任务才通知
  useSessionCompleteNotification();

  // F020 notification click → main 推 'notification.clicked' 带 sessionId；
  // 这里订阅 push 通道，切到对应 session 让用户回到正在跑的对话。
  //
  // v0.1.3.1 修复（F020-H2）：notification 在 OS 通知中心可能存留几分钟到数小时，
  // 期间用户可能删了对应 session。点已删 session 会把 currentSessionId 写成一个不存在
  // 的 id，后续 Shell / ConversationStreamV2 读取时会 null-deref。检查 sessionId 仍存在
  // 才 setCurrentSession；否则静默丢弃（用户感知就是"点了通知没反应"，比白屏 crash 好）。
  const setCurrentSessionForNotif = useAppStore((s) => s.setCurrentSession);
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const unsub = window.kodaxSpace.on('notification.clicked', (payload) => {
      if (!payload.sessionId) return;
      const exists = useAppStore.getState().sessions.some((s) => s.sessionId === payload.sessionId);
      if (exists) setCurrentSessionForNotif(payload.sessionId);
    });
    return () => unsub();
  }, [setCurrentSessionForNotif]);

  // F021 v0.1.5 drag-drop install：把 .mcpb / .dxt 文件拖进 Space 主窗口即触发安装。
  // 走跟 "Install ext" 按钮同一条 IPC（mcpb.install + filePath）。
  // 不属于 mcpb 类的文件 → preventDefault 把浏览器默认 navigate-to-file 行为挡住，但不调 IPC。
  useEffect(() => {
    if (!window.kodaxSpace) return;
    const onDragOver = (e: DragEvent): void => {
      // 必须 preventDefault 才会触发 drop 事件
      e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const f of Array.from(files)) {
        const name = f.name.toLowerCase();
        if (!name.endsWith('.mcpb') && !name.endsWith('.dxt')) continue;
        // Electron renderer 在 dropped File 上额外暴露 .path 字段（非标准 Web API）
        const filePath = (f as File & { path?: string }).path;
        if (typeof filePath !== 'string' || filePath.length === 0) continue;
        // fire-and-forget；main 端会用 native notification 给用户成功 / 失败反馈
        void window.kodaxSpace!.invoke('mcpb.install', { filePath });
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

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
        <Shell version={version} />
        {showSettings && (
          <SettingsModal initialTab="providers" onClose={() => setShowSettings(false)} />
        )}
        <QuickAskPopover open={showQuickAsk} onClose={() => setShowQuickAsk(false)} />
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface text-fg-primary">
      <header className="border-b border-border-default px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-ok" aria-hidden />
        <h1 className="text-sm font-semibold">KodaX Space</h1>
        <span className="text-xs text-fg-muted font-mono">v{version?.spaceVersion ?? '?.?.?'}</span>
        <button
          type="button"
          onClick={() => setShowFiles((v) => !v)}
          className={`ml-auto px-2 py-1 text-xs rounded border border-border-default flex items-center gap-1.5 ${
            showFiles
              ? 'bg-surface-3 text-fg-primary'
              : 'bg-surface-2 text-fg-muted hover:bg-hover-bg'
          }`}
          title="Toggle file panel"
        >
          <Folder className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          <span>Files</span>
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="px-2 py-1 text-xs rounded bg-surface-2 border border-border-default text-fg-secondary hover:bg-hover-bg flex items-center gap-1.5"
          title="Provider settings"
        >
          <Settings className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          <span className="font-mono">
            {defaultProvider
              ? defaultProvider.displayName
              : `${configuredCount}/${providers.length} providers`}
          </span>
        </button>
        <span className="text-[11px] text-fg-faint font-mono">
          {version
            ? `electron ${version.electronVersion} · chromium ${version.chromeVersion}`
            : 'loading…'}
        </span>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-60 flex flex-col border-r border-border-default flex-shrink-0">
          <ProjectPicker />
          <SessionList />
        </aside>
        <EventStream />
        {showFiles && <FilePanel />}
      </div>

      <footer className="border-t border-border-default px-4 py-1.5 text-[11px] text-fg-faint flex justify-between flex-shrink-0">
        <span>
          FEATURE_004 · Mock adapter · docs:{' '}
          <code className="font-mono text-fg-muted">docs/HLD.md</code>
        </span>
        <span>{version?.platform ?? ''}</span>
      </footer>

      <PermissionModal />
      <AskUserModal />
      {showSettings && (
        <SettingsModal initialTab="providers" onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

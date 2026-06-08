// TerminalManager — F023 多 tab 终端容器
//
// 在 F011 Terminal 基础上加 tab 管理层：每个 tab = 一个独立 Terminal 实例 = 一个 PTY。
//
// 关键设计：
//   - 非 active tab 用 `display:none` 隐藏，**不** unmount — PTY 保持活跃，shell 状态留住
//   - 切换 tab 时 ResizeObserver 自然探到容器尺寸变化触发 fit + IPC resize
//     (Terminal.tsx 守 offsetWidth/Height=0 时跳过，避免 hidden tab 收到 1×1 SIGWINCH)
//   - 每个 Terminal 内部独立管理 terminalId，跟邻居 tab 0 共享状态
//   - 关闭最后一个 tab 时立即补一个新 tab（避免空白；真想关 popout 走顶栏 ×）
//
// 状态原子性：tabs + activeId + counter 是耦合状态 → useReducer 单一 dispatch 一次性更新，
// 避免 setState 函数式 updater 内调用另一个 setState 的"impure updater" 反 React 规则
// （review MEDIUM）+ 解决 StrictMode 双 invoke 导致 id 跳号问题。
//
// reducer 抽到 tabsReducer.ts 让单测可以 import 不拖 React/window/xterm。
//
// 限制：
//   - 最多 MAX_TABS=10；超过 + 按钮 disable。Main 端 (ipc/terminal.ts) 同样硬约束。
//   - 项目切换：因 Terminal 内部 useEffect 已经监听 currentProjectPath，
//     manager 不需要重启 — Terminal 自己 kill 旧 PTY 起新 PTY，**继承** tab id。
//     (用户行为：切项目 → 所有 tab 同时重启 shell。当前接受，未来可考虑"tab 跟项目走")

import { useCallback, useReducer } from 'react';
import { Terminal } from './Terminal.js';
import { tabsReducer, initialTabsState, MAX_TABS } from './tabsReducer.js';

export function TerminalManager(): JSX.Element {
  const [state, dispatch] = useReducer(tabsReducer, undefined, initialTabsState);

  const canAddMore = state.tabs.length < MAX_TABS;

  const addTab = useCallback(() => dispatch({ type: 'ADD' }), []);
  const closeTab = useCallback((tabId: string) => dispatch({ type: 'CLOSE', tabId }), []);
  const activateTab = useCallback((tabId: string) => dispatch({ type: 'ACTIVATE', tabId }), []);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-border-default/60 bg-surface text-xs flex-shrink-0">
        <div className="flex flex-1 overflow-x-auto">
          {state.tabs.map((tab) => {
            const isActive = tab.id === state.activeId;
            return (
              <div
                key={tab.id}
                className={`flex items-center gap-1 px-2 py-1 border-r border-border-default/60 cursor-pointer ${
                  isActive ? 'bg-surface-2 text-fg-primary' : 'text-fg-muted hover:bg-hover-bg'
                }`}
                onClick={() => activateTab(tab.id)}
              >
                <span className="select-none">{tab.label}</span>
                <button
                  type="button"
                  className="ml-1 px-1 text-fg-muted hover:text-fg-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  aria-label={`Close ${tab.label}`}
                  title="Close tab"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="px-2 py-1 border-l border-border-default/60 text-fg-muted hover:text-fg-primary disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={addTab}
          disabled={!canAddMore}
          aria-label="New terminal tab"
          title={canAddMore ? 'New terminal tab' : `Max ${MAX_TABS} tabs`}
        >
          +
        </button>
      </div>

      {/* Tab content — 全部保留挂载，非 active 用 display:none 隐藏让 PTY 活着 */}
      <div className="flex-1 min-h-0 relative">
        {state.tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === state.activeId ? 'block' : 'none' }}
          >
            <Terminal />
          </div>
        ))}
      </div>
    </div>
  );
}

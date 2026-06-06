// Pure reducer + types for TerminalManager — extracted so unit tests can import
// without dragging React / window / xterm into the test runtime.

export const MAX_TABS = 10;

export interface Tab {
  readonly id: string;
  readonly label: string;
}

export interface State {
  readonly tabs: readonly Tab[];
  readonly activeId: string;
  readonly counter: number;
}

export type Action =
  | { readonly type: 'ADD' }
  | { readonly type: 'CLOSE'; readonly tabId: string }
  | { readonly type: 'ACTIVATE'; readonly tabId: string };

function makeTab(counter: number): Tab {
  return { id: `tab-${counter}`, label: `Terminal ${counter}` };
}

export function initialTabsState(): State {
  const initial = makeTab(1);
  return { tabs: [initial], activeId: initial.id, counter: 1 };
}

export function tabsReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD': {
      if (state.tabs.length >= MAX_TABS) return state;
      const nextCounter = state.counter + 1;
      const tab = makeTab(nextCounter);
      return {
        tabs: [...state.tabs, tab],
        activeId: tab.id,
        counter: nextCounter,
      };
    }
    case 'CLOSE': {
      const remaining = state.tabs.filter((t) => t.id !== action.tabId);
      // 关掉最后一个 → 补一个新 tab
      if (remaining.length === 0) {
        const nextCounter = state.counter + 1;
        const tab = makeTab(nextCounter);
        return { tabs: [tab], activeId: tab.id, counter: nextCounter };
      }
      // 关掉当前 active → 切到右邻（或最后一个）
      if (action.tabId === state.activeId) {
        const idx = state.tabs.findIndex((t) => t.id === action.tabId);
        const nextActive = remaining[Math.min(idx, remaining.length - 1)] ?? remaining[0]!;
        return { ...state, tabs: remaining, activeId: nextActive.id };
      }
      return { ...state, tabs: remaining };
    }
    case 'ACTIVATE': {
      if (action.tabId === state.activeId) return state;
      // 防 activate 到不存在的 tab（race 兜底）
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return { ...state, activeId: action.tabId };
    }
  }
}

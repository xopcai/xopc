import { create } from 'zustand';

export const TERMINAL_HEIGHT_MIN = 180;
export const TERMINAL_HEIGHT_MAX = 640;
export const TERMINAL_HEIGHT_DEFAULT = 300;
export const TERMINALS_PER_SESSION_MAX = 8;

export type TerminalTab = {
  key: string;
};

const EMPTY_TERMINAL_TABS: TerminalTab[] = [];

export function selectTerminalTabs(
  tabsBySessionKey: Record<string, TerminalTab[]>,
  sessionKey: string,
): TerminalTab[] {
  return tabsBySessionKey[sessionKey] ?? EMPTY_TERMINAL_TABS;
}

let terminalKeySequence = 0;

function createTerminalKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `terminal-${Date.now()}-${++terminalKeySequence}`;
}

export function clampTerminalHeight(height: number): number {
  const viewportLimit = typeof window === 'undefined'
    ? TERMINAL_HEIGHT_MAX
    : Math.max(TERMINAL_HEIGHT_MIN, Math.floor(window.innerHeight * 0.65));
  return Math.min(TERMINAL_HEIGHT_MAX, viewportLimit, Math.max(TERMINAL_HEIGHT_MIN, Math.round(height)));
}

type TerminalPanelState = {
  openBySessionKey: Record<string, boolean>;
  tabsBySessionKey: Record<string, TerminalTab[]>;
  activeTabKeyBySessionKey: Record<string, string | undefined>;
  height: number;
  toggle: (sessionKey: string) => void;
  close: (sessionKey: string) => void;
  addTerminal: (sessionKey: string) => string;
  closeTerminal: (sessionKey: string, terminalKey: string) => void;
  setActiveTerminal: (sessionKey: string, terminalKey: string) => void;
  setHeight: (height: number) => void;
};

export const useTerminalPanelStore = create<TerminalPanelState>((set, get) => ({
  openBySessionKey: {},
  tabsBySessionKey: {},
  activeTabKeyBySessionKey: {},
  height: TERMINAL_HEIGHT_DEFAULT,
  toggle: (sessionKey) => {
    const state = get();
    const nextOpen = !state.openBySessionKey[sessionKey];
    if (!nextOpen || state.tabsBySessionKey[sessionKey]?.length) {
      set({ openBySessionKey: { ...state.openBySessionKey, [sessionKey]: nextOpen } });
      return;
    }
    const key = createTerminalKey();
    set({
      openBySessionKey: { ...state.openBySessionKey, [sessionKey]: true },
      tabsBySessionKey: { ...state.tabsBySessionKey, [sessionKey]: [{ key }] },
      activeTabKeyBySessionKey: { ...state.activeTabKeyBySessionKey, [sessionKey]: key },
    });
  },
  close: (sessionKey) => set((state) => ({
    openBySessionKey: { ...state.openBySessionKey, [sessionKey]: false },
  })),
  addTerminal: (sessionKey) => {
    const state = get();
    const tabs = state.tabsBySessionKey[sessionKey] ?? [];
    if (tabs.length >= TERMINALS_PER_SESSION_MAX) {
      return state.activeTabKeyBySessionKey[sessionKey] ?? tabs[0].key;
    }
    const key = createTerminalKey();
    set({
      tabsBySessionKey: { ...state.tabsBySessionKey, [sessionKey]: [...tabs, { key }] },
      activeTabKeyBySessionKey: { ...state.activeTabKeyBySessionKey, [sessionKey]: key },
    });
    return key;
  },
  closeTerminal: (sessionKey, terminalKey) => set((state) => {
    const tabs = state.tabsBySessionKey[sessionKey] ?? [];
    const closingIndex = tabs.findIndex((tab) => tab.key === terminalKey);
    if (closingIndex < 0) return state;
    const remaining = tabs.filter((tab) => tab.key !== terminalKey);
    const activeKey = state.activeTabKeyBySessionKey[sessionKey];
    const nextActiveKey = activeKey === terminalKey
      ? remaining[Math.min(closingIndex, remaining.length - 1)]?.key
      : activeKey;
    return {
      tabsBySessionKey: { ...state.tabsBySessionKey, [sessionKey]: remaining },
      activeTabKeyBySessionKey: {
        ...state.activeTabKeyBySessionKey,
        [sessionKey]: nextActiveKey,
      },
    };
  }),
  setActiveTerminal: (sessionKey, terminalKey) => set((state) => {
    if (!(state.tabsBySessionKey[sessionKey] ?? []).some((tab) => tab.key === terminalKey)) {
      return state;
    }
    return {
      activeTabKeyBySessionKey: {
        ...state.activeTabKeyBySessionKey,
        [sessionKey]: terminalKey,
      },
    };
  }),
  setHeight: (height) => set({ height: clampTerminalHeight(height) }),
}));

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
  tabsByConversationId: Record<string, TerminalTab[]>,
  conversationId: string,
): TerminalTab[] {
  return tabsByConversationId[conversationId] ?? EMPTY_TERMINAL_TABS;
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
  openByConversationId: Record<string, boolean>;
  tabsByConversationId: Record<string, TerminalTab[]>;
  activeTabKeyByConversationId: Record<string, string | undefined>;
  height: number;
  open: (conversationId: string) => void;
  toggle: (conversationId: string) => void;
  close: (conversationId: string) => void;
  addTerminal: (conversationId: string) => string;
  closeTerminal: (conversationId: string, terminalKey: string) => void;
  setActiveTerminal: (conversationId: string, terminalKey: string) => void;
  setHeight: (height: number) => void;
};

export const useTerminalPanelStore = create<TerminalPanelState>((set, get) => ({
  openByConversationId: {},
  tabsByConversationId: {},
  activeTabKeyByConversationId: {},
  height: TERMINAL_HEIGHT_DEFAULT,
  open: (conversationId) => {
    const state = get();
    if (state.tabsByConversationId[conversationId]?.length) {
      set({ openByConversationId: { ...state.openByConversationId, [conversationId]: true } });
      return;
    }
    const key = createTerminalKey();
    set({
      openByConversationId: { ...state.openByConversationId, [conversationId]: true },
      tabsByConversationId: { ...state.tabsByConversationId, [conversationId]: [{ key }] },
      activeTabKeyByConversationId: { ...state.activeTabKeyByConversationId, [conversationId]: key },
    });
  },
  toggle: (conversationId) => {
    const state = get();
    const nextOpen = !state.openByConversationId[conversationId];
    if (!nextOpen || state.tabsByConversationId[conversationId]?.length) {
      set({ openByConversationId: { ...state.openByConversationId, [conversationId]: nextOpen } });
      return;
    }
    state.open(conversationId);
  },
  close: (conversationId) => set((state) => ({
    openByConversationId: { ...state.openByConversationId, [conversationId]: false },
  })),
  addTerminal: (conversationId) => {
    const state = get();
    const tabs = state.tabsByConversationId[conversationId] ?? [];
    if (tabs.length >= TERMINALS_PER_SESSION_MAX) {
      return state.activeTabKeyByConversationId[conversationId] ?? tabs[0].key;
    }
    const key = createTerminalKey();
    set({
      tabsByConversationId: { ...state.tabsByConversationId, [conversationId]: [...tabs, { key }] },
      activeTabKeyByConversationId: { ...state.activeTabKeyByConversationId, [conversationId]: key },
    });
    return key;
  },
  closeTerminal: (conversationId, terminalKey) => set((state) => {
    const tabs = state.tabsByConversationId[conversationId] ?? [];
    const closingIndex = tabs.findIndex((tab) => tab.key === terminalKey);
    if (closingIndex < 0) return state;
    const remaining = tabs.filter((tab) => tab.key !== terminalKey);
    const activeKey = state.activeTabKeyByConversationId[conversationId];
    const nextActiveKey = activeKey === terminalKey
      ? remaining[Math.min(closingIndex, remaining.length - 1)]?.key
      : activeKey;
    return {
      tabsByConversationId: { ...state.tabsByConversationId, [conversationId]: remaining },
      activeTabKeyByConversationId: {
        ...state.activeTabKeyByConversationId,
        [conversationId]: nextActiveKey,
      },
    };
  }),
  setActiveTerminal: (conversationId, terminalKey) => set((state) => {
    if (!(state.tabsByConversationId[conversationId] ?? []).some((tab) => tab.key === terminalKey)) {
      return state;
    }
    return {
      activeTabKeyByConversationId: {
        ...state.activeTabKeyByConversationId,
        [conversationId]: terminalKey,
      },
    };
  }),
  setHeight: (height) => set({ height: clampTerminalHeight(height) }),
}));

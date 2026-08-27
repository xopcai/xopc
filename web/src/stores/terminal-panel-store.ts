import { create } from 'zustand';

export const TERMINAL_HEIGHT_MIN = 180;
export const TERMINAL_HEIGHT_MAX = 640;
export const TERMINAL_HEIGHT_DEFAULT = 300;

export function clampTerminalHeight(height: number): number {
  const viewportLimit = typeof window === 'undefined'
    ? TERMINAL_HEIGHT_MAX
    : Math.max(TERMINAL_HEIGHT_MIN, Math.floor(window.innerHeight * 0.65));
  return Math.min(TERMINAL_HEIGHT_MAX, viewportLimit, Math.max(TERMINAL_HEIGHT_MIN, Math.round(height)));
}

type TerminalPanelState = {
  openBySessionKey: Record<string, boolean>;
  approvedSessionIds: Record<string, boolean>;
  height: number;
  toggle: (sessionKey: string) => void;
  close: (sessionKey: string) => void;
  approve: (sessionId: string) => void;
  setHeight: (height: number) => void;
};

export const useTerminalPanelStore = create<TerminalPanelState>((set) => ({
  openBySessionKey: {},
  approvedSessionIds: {},
  height: TERMINAL_HEIGHT_DEFAULT,
  toggle: (sessionKey) => set((state) => ({
    openBySessionKey: {
      ...state.openBySessionKey,
      [sessionKey]: !state.openBySessionKey[sessionKey],
    },
  })),
  close: (sessionKey) => set((state) => ({
    openBySessionKey: { ...state.openBySessionKey, [sessionKey]: false },
  })),
  approve: (sessionId) => set((state) => ({
    approvedSessionIds: { ...state.approvedSessionIds, [sessionId]: true },
  })),
  setHeight: (height) => set({ height: clampTerminalHeight(height) }),
}));

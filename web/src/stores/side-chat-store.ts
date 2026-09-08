import { create } from 'zustand';

import type { SideChatSelection, SideChatTab } from '@/features/side-chat/side-chat.types';
import type { Message } from '@/features/chat/messages/messages.types';
import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { buildSideChatReading, SIDE_CHAT_READING_BYTES, type SideChatReading } from '@/features/side-chat/side-chat-reading';
import { useGatewayStore } from './gateway-store';

const STORAGE_KEY = 'xopc:side-chat-panes:v2';
export const SIDE_CHAT_WIDTH_MIN = 360;
export const SIDE_CHAT_WIDTH_MAX = 760;
export const SIDE_CHAT_WIDTH_DEFAULT = 520;

export type SessionSideChatPane = { open: boolean; activeId: string | null };
type StoredState = {
  panes: Record<string, SessionSideChatPane>;
  tabs: SideChatTab[];
  widthPx: number;
};
type PendingCreate = { requestId: string; parentSessionKey: string; selections: SideChatSelection[] };
export type SideChatDraft = { text: string; attachments: Attachment[] };
const EMPTY_DRAFT: SideChatDraft = { text: '', attachments: [] };

function clampWidth(width: number): number {
  return Math.min(SIDE_CHAT_WIDTH_MAX, Math.max(SIDE_CHAT_WIDTH_MIN, Math.round(width)));
}

function emptyState(): StoredState {
  return { panes: {}, tabs: [], widthPx: SIDE_CHAT_WIDTH_DEFAULT };
}

function readState(): StoredState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') as Partial<StoredState>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((tab): tab is SideChatTab => Boolean(tab?.id && tab.parentSessionKey))
      : [];
    const rawPanes = parsed.panes && typeof parsed.panes === 'object' ? parsed.panes : {};
    const panes = Object.fromEntries(Object.entries(rawPanes).map(([parentSessionKey, pane]) => {
      const sessionTabs = tabs.filter((tab) => tab.parentSessionKey === parentSessionKey);
      const activeId = typeof pane?.activeId === 'string' && sessionTabs.some((tab) => tab.id === pane.activeId)
        ? pane.activeId
        : sessionTabs.at(-1)?.id ?? null;
      return [parentSessionKey, { open: pane?.open === true && sessionTabs.length > 0, activeId }];
    }));
    for (const tab of tabs) {
      panes[tab.parentSessionKey] ??= { open: false, activeId: tab.id };
    }
    return {
      panes,
      tabs,
      widthPx: clampWidth(typeof parsed.widthPx === 'number' ? parsed.widthPx : SIDE_CHAT_WIDTH_DEFAULT),
    };
  } catch {
    return emptyState();
  }
}

function persist(state: StoredState): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

type SideChatPaneState = StoredState & {
  drafts: Record<string, SideChatDraft>;
  readings: Record<string, SideChatReading>;
  setDraftText: (id: string, text: string) => void;
  setDraftAttachments: (id: string, attachments: Attachment[]) => void;
  rememberMessages: (id: string, messages: Message[]) => void;
  markEnded: (id: string, reason: NonNullable<SideChatTab['ended']>) => void;
  replaceTab: (oldId: string, tab: SideChatTab) => void;
  reset: () => void;
  pendingCreate: PendingCreate | null;
  requestCreate: (parentSessionKey: string, selections?: SideChatSelection[]) => void;
  claimPendingCreate: (parentSessionKey: string, requestId: string) => PendingCreate | null;
  addTab: (tab: SideChatTab) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  setTabRunId: (id: string, runId?: string) => void;
  setOpen: (parentSessionKey: string, open: boolean) => void;
  setWidthPx: (width: number) => void;
};

const initial = readState();

export const useSideChatStore = create<SideChatPaneState>((set, get) => {
  const commit = (patch: Partial<StoredState>) => {
    set(patch);
    queueMicrotask(() => {
      const state = get();
      persist({ panes: state.panes, tabs: state.tabs, widthPx: state.widthPx });
    });
  };
  const updatePane = (parentSessionKey: string, patch: Partial<SessionSideChatPane>) => {
    const current = get().panes[parentSessionKey] ?? { open: false, activeId: null };
    commit({ panes: { ...get().panes, [parentSessionKey]: { ...current, ...patch } } });
  };

  return {
    ...initial,
    drafts: {},
    readings: {},
    setDraftText: (id, text) => set({
      drafts: {
        ...get().drafts,
        [id]: { ...(get().drafts[id] ?? EMPTY_DRAFT), text },
      },
    }),
    setDraftAttachments: (id, attachments) => set({
      drafts: {
        ...get().drafts,
        [id]: { ...(get().drafts[id] ?? EMPTY_DRAFT), attachments },
      },
    }),
    rememberMessages: (id, messages) => {
      const readings = { ...get().readings };
      delete readings[id];
      readings[id] = buildSideChatReading(messages);
      readings[id].truncated ||= get().readings[id]?.truncated ?? false;
      let bytes = Object.values(readings).reduce((sum, entry) => sum + entry.bytes, 0);
      while (Object.keys(readings).length > 5 || bytes > SIDE_CHAT_READING_BYTES) {
        const oldest = Object.keys(readings)[0];
        bytes -= readings[oldest].bytes;
        delete readings[oldest];
      }
      set({ readings });
    },
    markEnded: (id, ended) => commit({ tabs: get().tabs.map((tab) => tab.id === id ? { ...tab, ended, runId: undefined } : tab) }),
    replaceTab: (oldId, tab) => {
      const state = get();
      if (!state.tabs.some((existing) => existing.id === oldId)) return;
      const drafts = { ...state.drafts, [tab.id]: state.drafts[oldId] ?? EMPTY_DRAFT };
      const readings = { ...state.readings };
      delete drafts[oldId];
      delete readings[oldId];
      set({ drafts, readings });
      commit({
        tabs: state.tabs.map((existing) => existing.id === oldId ? { ...tab, fresh: true } : existing),
        panes: {
          ...state.panes,
          [tab.parentSessionKey]: {
            open: state.panes[tab.parentSessionKey]?.open ?? false,
            activeId: state.panes[tab.parentSessionKey]?.activeId === oldId ? tab.id : state.panes[tab.parentSessionKey]?.activeId ?? tab.id,
          },
        },
      });
    },
    reset: () => {
      set({ drafts: {}, readings: {}, pendingCreate: null });
      commit({ panes: {}, tabs: [] });
    },
    pendingCreate: null,
    requestCreate: (parentSessionKey, selections = []) => {
      set({ pendingCreate: { requestId: crypto.randomUUID(), parentSessionKey, selections } });
      updatePane(parentSessionKey, { open: true });
    },
    claimPendingCreate: (parentSessionKey, requestId) => {
      const pending = get().pendingCreate;
      if (!pending || pending.parentSessionKey !== parentSessionKey || pending.requestId !== requestId) {
        return null;
      }
      set({ pendingCreate: null });
      return pending;
    },
    addTab: (tab) => {
      const tabs = [...get().tabs.filter((existing) => existing.id !== tab.id), tab];
      const current = get().panes[tab.parentSessionKey] ?? { open: false, activeId: null };
      commit({
        tabs,
        panes: {
          ...get().panes,
          [tab.parentSessionKey]: { ...current, activeId: tab.id, open: true },
        },
      });
    },
    removeTab: (id) => {
      const removed = get().tabs.find((tab) => tab.id === id);
      if (!removed) return;
      const drafts = { ...get().drafts };
      const readings = { ...get().readings };
      delete drafts[id];
      delete readings[id];
      set({ drafts, readings });
      const tabs = get().tabs.filter((tab) => tab.id !== id);
      const sessionTabs = tabs.filter((tab) => tab.parentSessionKey === removed.parentSessionKey);
      const current = get().panes[removed.parentSessionKey] ?? { open: false, activeId: null };
      const activeId = current.activeId === id ? sessionTabs.at(-1)?.id ?? null : current.activeId;
      commit({
        tabs,
        panes: {
          ...get().panes,
          [removed.parentSessionKey]: { open: sessionTabs.length > 0 && current.open, activeId },
        },
      });
    },
    setActive: (id) => {
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (tab) updatePane(tab.parentSessionKey, { activeId: id, open: true });
    },
    setTabRunId: (id, runId) => commit({
      tabs: get().tabs.map((tab) => tab.id === id ? { ...tab, runId } : tab),
    }),
    setOpen: (parentSessionKey, open) => updatePane(parentSessionKey, { open }),
    setWidthPx: (widthPx) => commit({ widthPx: clampWidth(widthPx) }),
  };
});

useGatewayStore.subscribe((state, previous) => {
  if (state.baseUrl !== previous.baseUrl || (previous.token !== undefined && state.token !== previous.token)) {
    useSideChatStore.getState().reset();
    try { sessionStorage.removeItem('xopc:side-chat-client-id'); } catch { /* Storage may be disabled. */ }
  }
});

import { create } from 'zustand';

import { useRightWorkspaceStore } from '@/stores/right-workspace-store';

import type { SideChatSelection, SideChatTab } from '@/features/side-chat/side-chat.types';
import type { Message } from '@/features/chat/messages/messages.types';
import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { buildSideChatReading, SIDE_CHAT_READING_BYTES, type SideChatReading } from '@/features/side-chat/side-chat-reading';
import { useGatewayStore } from './gateway-store';

const STORAGE_KEY = 'xopc:side-chat-panes:v3';
export const SIDE_CHAT_WIDTH_MIN = 360;
export const SIDE_CHAT_WIDTH_MAX = 760;
export const SIDE_CHAT_WIDTH_DEFAULT = 520;

export type SessionSideChatPane = { open: boolean; activeId: string | null };
type StoredState = {
  panes: Record<string, SessionSideChatPane>;
  tabs: SideChatTab[];
  widthPx: number;
};
type PendingCreate = { requestId: string; parentConversationId: string; selections: SideChatSelection[] };
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
    const identity = (parsed as Partial<StoredState> & { identity?: string }).identity;
    if (identity && identity !== useGatewayStore.getState().conversationId) return emptyState();
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((tab): tab is SideChatTab => Boolean(tab?.id && tab.parentConversationId))
      : [];
    const rawPanes = parsed.panes && typeof parsed.panes === 'object' ? parsed.panes : {};
    const panes = Object.fromEntries(Object.entries(rawPanes).map(([parentConversationId, pane]) => {
      const sessionTabs = tabs.filter((tab) => tab.parentConversationId === parentConversationId);
      const activeId = typeof pane?.activeId === 'string' && sessionTabs.some((tab) => tab.id === pane.activeId)
        ? pane.activeId
        : sessionTabs.at(-1)?.id ?? null;
      return [parentConversationId, { open: pane?.open === true && sessionTabs.length > 0, activeId }];
    }));
    for (const tab of tabs) {
      panes[tab.parentConversationId] ??= { open: false, activeId: tab.id };
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
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, identity: useGatewayStore.getState().conversationId })); } catch { /* ignore */ }
}

type SideChatPaneState = StoredState & {
  drafts: Record<string, SideChatDraft>;
  readings: Record<string, SideChatReading>;
  setDraftText: (id: string, text: string) => void;
  setDraftAttachments: (id: string, attachments: Attachment[]) => void;
  rememberMessages: (id: string, messages: Message[]) => void;
  markEnded: (id: string, reason: NonNullable<SideChatTab['ended']>) => void;
  markPromoted: (id: string, conversationId: string) => void;
  replaceTab: (oldId: string, tab: SideChatTab) => void;
  reset: () => void;
  pendingCreate: PendingCreate | null;
  creatingRequests: Record<string, string>;
  requestCreate: (parentConversationId: string, selections?: SideChatSelection[]) => void;
  claimPendingCreate: (parentConversationId: string, requestId: string) => PendingCreate | null;
  finishCreate: (parentConversationId: string, requestId: string) => void;
  addTab: (tab: SideChatTab, activate?: boolean) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  setTabStatus: (id: string, status: { waiting: boolean; disconnected: boolean; unread: boolean }) => void;
  setTabRunId: (id: string, runId?: string) => void;
  setOpen: (parentConversationId: string, open: boolean) => void;
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
  const updatePane = (parentConversationId: string, patch: Partial<SessionSideChatPane>) => {
    const current = get().panes[parentConversationId] ?? { open: false, activeId: null };
    commit({ panes: { ...get().panes, [parentConversationId]: { ...current, ...patch } } });
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
    markPromoted: (id, conversationId) => commit({
      tabs: get().tabs.map((tab) => tab.id === id
        ? { ...tab, ended: 'promoted', promotedConversationId: conversationId, runId: undefined }
        : tab),
    }),
    replaceTab: (oldId, tab) => {
      useRightWorkspaceStore.getState().replaceSideChat(oldId, tab.id, tab.parentConversationId);
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
          [tab.parentConversationId]: {
            open: state.panes[tab.parentConversationId]?.open ?? false,
            activeId: state.panes[tab.parentConversationId]?.activeId === oldId ? tab.id : state.panes[tab.parentConversationId]?.activeId ?? tab.id,
          },
        },
      });
    },
    reset: () => {
      useRightWorkspaceStore.getState().reset();
      set({ drafts: {}, readings: {}, pendingCreate: null, creatingRequests: {} });
      commit({ panes: {}, tabs: [] });
    },
    pendingCreate: null,
    creatingRequests: {},
    requestCreate: (parentConversationId, selections = []) => {
      useRightWorkspaceStore.getState().setOpen(true, parentConversationId);
      if (get().creatingRequests[parentConversationId] || get().pendingCreate?.parentConversationId === parentConversationId) return;
      set({ pendingCreate: { requestId: crypto.randomUUID(), parentConversationId, selections } });
      updatePane(parentConversationId, { open: true });
    },
    claimPendingCreate: (parentConversationId, requestId) => {
      const pending = get().pendingCreate;
      if (!pending || pending.parentConversationId !== parentConversationId || pending.requestId !== requestId) {
        return null;
      }
      set({ pendingCreate: null, creatingRequests: { ...get().creatingRequests, [parentConversationId]: requestId } });
      return pending;
    },
    finishCreate: (parentConversationId, requestId) => {
      if (get().creatingRequests[parentConversationId] !== requestId) return;
      const creatingRequests = { ...get().creatingRequests };
      delete creatingRequests[parentConversationId];
      set({ creatingRequests });
    },
    addTab: (tab, activate = true) => {
      useRightWorkspaceStore.getState().addSideChat(tab.id, tab.title, tab.parentConversationId, activate);
      const tabs = [...get().tabs.filter((existing) => existing.id !== tab.id), { ...tab, lastSelectedAt: Date.now() }];
      const current = get().panes[tab.parentConversationId] ?? { open: false, activeId: null };
      commit({
        tabs,
        panes: {
          ...get().panes,
          [tab.parentConversationId]: { ...current, activeId: tab.id, open: true },
        },
      });
    },
    removeTab: (id) => {
      const removed = get().tabs.find((tab) => tab.id === id);
      if (!removed) return;
      useRightWorkspaceStore.getState().remove(`side:${id}`, removed.parentConversationId);
      const drafts = { ...get().drafts };
      const readings = { ...get().readings };
      delete drafts[id];
      delete readings[id];
      set({ drafts, readings });
      const tabs = get().tabs.filter((tab) => tab.id !== id);
      const sessionTabs = tabs.filter((tab) => tab.parentConversationId === removed.parentConversationId);
      const current = get().panes[removed.parentConversationId] ?? { open: false, activeId: null };
      const activeId = current.activeId === id ? sessionTabs.at(-1)?.id ?? null : current.activeId;
      commit({
        tabs,
        panes: {
          ...get().panes,
          [removed.parentConversationId]: { open: sessionTabs.length > 0 && current.open, activeId },
        },
      });
    },
    setActive: (id) => {
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (tab) {
        useRightWorkspaceStore.getState().activate(`side:${id}`, tab.parentConversationId);
        commit({ tabs: get().tabs.map((candidate) => candidate.id === id ? { ...candidate, lastSelectedAt: Date.now() } : candidate) });
        updatePane(tab.parentConversationId, { activeId: id, open: true });
      }
    },
    setTabStatus: (id, status) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (tab && (tab.waiting !== status.waiting || tab.disconnected !== status.disconnected || tab.unread !== status.unread)) set({ tabs: get().tabs.map((t) => t.id === id ? { ...t, ...status } : t) });
    },
    setTabRunId: (id, runId) => commit({
      tabs: get().tabs.map((tab) => tab.id === id ? { ...tab, runId } : tab),
    }),
    setOpen: (parentConversationId, open) => {
      useRightWorkspaceStore.getState().setOpen(open, parentConversationId);
      if (!open) {
        updatePane(parentConversationId, { open });
        return;
      }
      const state = get();
      const tabs = state.tabs.filter((tab) => tab.parentConversationId === parentConversationId && !tab.ended && !tab.promotedConversationId);
      const active = tabs.find((tab) => tab.id === state.panes[parentConversationId]?.activeId)
        ?? tabs.reduce<SideChatTab | undefined>((latest, tab) => (
          !latest || (tab.lastSelectedAt ?? 0) >= (latest.lastSelectedAt ?? 0) ? tab : latest
        ), undefined);
      updatePane(parentConversationId, { open, activeId: active?.id ?? null });
      if (active) useRightWorkspaceStore.getState().activate(`side:${active.id}`, parentConversationId);
      if (!active) state.requestCreate(parentConversationId);
    },
    setWidthPx: (widthPx) => commit({ widthPx: clampWidth(widthPx) }),
  };
});

useGatewayStore.subscribe((state, previous) => {
  if (state.conversationId && !previous.conversationId && state.baseUrl === previous.baseUrl) {
    const restored = readState();
    useSideChatStore.setState(restored);
  }
  if (state.baseUrl !== previous.baseUrl || (previous.conversationId !== undefined && state.conversationId !== previous.conversationId)) {
    useSideChatStore.getState().reset();
    try { sessionStorage.removeItem('xopc:side-chat-client-id'); } catch { /* Storage may be disabled. */ }
  }
});

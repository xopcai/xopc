import { create } from 'zustand';

import { KEYS, storage, type KeyValueStorage } from '../../storage/mmkv';

export type ChatSelection = { key: string; revision: number };
export const EMPTY_CHAT_SELECTION: ChatSelection = { key: '', revision: 0 };

type ChatSelectionState = {
  selections: Record<string, ChatSelection>;
  select: (gatewayId: string, key: string) => ChatSelection;
  beginSelection: (gatewayId: string) => ChatSelection;
  selectIfCurrent: (gatewayId: string, expected: ChatSelection, key: string) => boolean;
};

/** Persist the user's selection immediately, independently of list/query cache freshness. */
export function createChatSelectionStore(kv: KeyValueStorage) {
  let selections: Record<string, ChatSelection> = {};
  try {
    const saved: unknown = JSON.parse(kv.getString(KEYS.mainChatSessionByGateway) ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      selections = Object.fromEntries(Object.entries(saved)
        .filter(([gatewayId, key]) => gatewayId && typeof key === 'string' && key.trim())
        .map(([gatewayId, key]) => [gatewayId, { key: (key as string).trim(), revision: 0 }]));
    }
  } catch { /* Ignore malformed local preferences. */ }

  return create<ChatSelectionState>((set, get) => ({
    selections,
    select: (gatewayId, key) => {
      const current = get().selections[gatewayId] ?? EMPTY_CHAT_SELECTION;
      if (!gatewayId) return current;
      const selection = { key: key.trim(), revision: current.revision + 1 };
      const next = { ...get().selections, [gatewayId]: selection };
      kv.set(KEYS.mainChatSessionByGateway, JSON.stringify(Object.fromEntries(
        Object.entries(next).filter(([, value]) => value.key).map(([id, value]) => [id, value.key]),
      )));
      set({ selections: next });
      return selection;
    },
    beginSelection: gatewayId => {
      const current = get().selections[gatewayId] ?? EMPTY_CHAT_SELECTION;
      const selection = { ...current, revision: current.revision + 1 };
      set({ selections: { ...get().selections, [gatewayId]: selection } });
      return selection;
    },
    selectIfCurrent: (gatewayId, expected, key) => {
      if ((get().selections[gatewayId] ?? EMPTY_CHAT_SELECTION) !== expected) return false;
      get().select(gatewayId, key);
      return true;
    },
  }));
}

export const useChatSelectionStore = createChatSelectionStore(storage);

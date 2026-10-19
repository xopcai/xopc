import type { TuiComposerHistoryItem } from './tui-backend.js';

type HistoryState = {
  items: TuiComposerHistoryItem[];
  revision: number;
  loadVersion: number;
  clearVersion: number;
  writeQueue: Promise<void>;
};

/** Session-scoped history; late responses never replace another session's editor history. */
export function createTuiComposerHistory(opts: {
  currentConversationId: () => string;
  load: (conversationId: string) => Promise<TuiComposerHistoryItem[]>;
  persist: (conversationId: string, text: string) => Promise<TuiComposerHistoryItem>;
  replace: (texts: string[]) => void;
}) {
  const sessions = new Map<string, HistoryState>();
  const stateFor = (id: string) => {
    let state = sessions.get(id);
    if (!state) {
      state = { items: [], revision: 0, loadVersion: 0, clearVersion: 0, writeQueue: Promise.resolve() };
      sessions.set(id, state);
    }
    return state;
  };
  const publish = (id: string) => {
    if (id === opts.currentConversationId()) opts.replace(stateFor(id).items.map(item => item.text));
  };
  const append = (item: TuiComposerHistoryItem) => {
    if (typeof item.conversationId !== 'string' || !item.conversationId || typeof item.text !== 'string' || typeof item.id !== 'number') return;
    const state = stateFor(item.conversationId);
    if (state.items.some(entry => item.id > 0 && entry.id === item.id)) return;
    state.revision += 1;
    const optimisticIndex = state.items.findIndex(entry => entry.id === 0 && entry.text === item.text);
    if (optimisticIndex >= 0 && item.id > 0) {
      state.items[optimisticIndex] = item;
      return;
    }
    if (state.items[0]?.text === item.text) {
      state.items[0] = item;
      return;
    }
    state.items = [item, ...state.items].slice(0, 100);
    publish(item.conversationId);
  };
  const refresh = async (id = opts.currentConversationId()): Promise<void> => {
    const state = stateFor(id);
    const loadVersion = ++state.loadVersion;
    try {
      await state.writeQueue;
      const revision = state.revision;
      const items = await opts.load(id);
      if (state.revision !== revision || state.loadVersion !== loadVersion) return;
      state.items = items.filter(item => item.conversationId === id).slice(0, 100);
      publish(id);
    } catch {
      // History is optional; retain this session's cache on transient failures.
    }
  };
  return {
    append,
    refresh,
    switchSession: () => {
      const id = opts.currentConversationId();
      publish(id);
      void refresh(id);
    },
    clear: (id: string) => {
      const state = stateFor(id);
      state.revision += 1;
      state.clearVersion += 1;
      state.items = [];
      publish(id);
    },
    record: (text: string, id = opts.currentConversationId()) => {
      text = text.trim();
      if (!text) return;
      const state = stateFor(id);
      const clearVersion = state.clearVersion;
      append({ conversationId: id, id: 0, text, createdAt: Date.now() });
      state.writeQueue = state.writeQueue.then(async () => {
        const item = await opts.persist(id, text);
        if (state.clearVersion === clearVersion && item.conversationId === id) append(item);
      }).catch(() => {});
    },
  };
}

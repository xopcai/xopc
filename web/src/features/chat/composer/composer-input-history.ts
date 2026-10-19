import { fetchJson } from '@/lib/fetch';

export const COMPOSER_INPUT_HISTORY_MAX = 100;

export type ComposerInputHistoryItem = {
  conversationId: string;
  id: number;
  text: string;
  createdAt: number;
};

type HistoryState = {
  items: ComposerInputHistoryItem[];
  loadPromise: Promise<void> | null;
  loaded: boolean;
  writeQueue: Promise<void>;
  mutationVersion: number;
  clearVersion: number;
};
const histories = new Map<string, HistoryState>();

function stateFor(conversationId: string): HistoryState {
  let state = histories.get(conversationId);
  if (!state) {
    state = { items: [], loadPromise: null, loaded: false, writeQueue: Promise.resolve(), mutationVersion: 0, clearVersion: 0 };
    histories.set(conversationId, state);
  }
  return state;
}

function prepend(state: HistoryState, item: ComposerInputHistoryItem): void {
  if (state.items[0]?.text === item.text) {
    if (item.id > 0) state.items[0] = item;
    return;
  }
  state.items = [item, ...state.items].slice(0, COMPOSER_INPUT_HISTORY_MAX);
}

function reconcileServerItem(state: HistoryState, item: ComposerInputHistoryItem): void {
  if (state.items.some(entry => entry.id === item.id)) return;
  const optimisticIndex = state.items.findIndex(entry => entry.id === 0 && entry.text === item.text);
  if (optimisticIndex >= 0) {
    state.items[optimisticIndex] = item;
    return;
  }
  prepend(state, item);
}

export function getComposerInputHistory(conversationId: string): string[] {
  return stateFor(conversationId).items.map(item => item.text);
}

export function loadComposerInputHistory(conversationId: string, force = false): Promise<void> {
  const state = stateFor(conversationId);
  if (state.loaded && !force) return Promise.resolve();
  if (state.loadPromise) return state.loadPromise;
  const versionAtStart = state.mutationVersion;
  let retryAfterMutation = false;
  state.loadPromise = state.writeQueue.then(() => fetchJson<{ items: ComposerInputHistoryItem[] }>(`/api/composer-history?conversationId=${encodeURIComponent(conversationId)}`))
    .then(response => {
      if (state.mutationVersion === versionAtStart) {
        state.items = response.items.filter(item => item.conversationId === conversationId).slice(0, COMPOSER_INPUT_HISTORY_MAX);
        state.loaded = true;
      } else {
        retryAfterMutation = true;
      }
    })
    .catch(() => {})
    .finally(() => {
      state.loadPromise = null;
      if (retryAfterMutation) void state.writeQueue.then(() => loadComposerInputHistory(conversationId, true));
    });
  return state.loadPromise;
}

/** Update the session's keypress cache immediately, then persist without blocking the composer. */
export function recordComposerInputHistory(conversationId: string, text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  const state = stateFor(conversationId);
  const clearVersion = state.clearVersion;
  state.mutationVersion += 1;
  prepend(state, { conversationId, id: 0, text: normalized, createdAt: Date.now() });
  state.writeQueue = state.writeQueue
    .then(async () => {
      const response = await fetchJson<{ item: ComposerInputHistoryItem }>('/api/composer-history', {
        method: 'POST',
        body: JSON.stringify({ conversationId, text: normalized }),
      });
      if (state.clearVersion === clearVersion && response.item.conversationId === conversationId) reconcileServerItem(state, response.item);
    })
    .catch(() => {});
}

export function applyComposerHistoryAppended(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const item = detail as ComposerInputHistoryItem;
  if (typeof item.conversationId !== 'string' || !item.conversationId || typeof item.id !== 'number'
    || typeof item.text !== 'string' || typeof item.createdAt !== 'number') return null;
  const state = stateFor(item.conversationId);
  state.mutationVersion += 1;
  reconcileServerItem(state, item);
  return item.conversationId;
}

export function applyComposerHistoryCleared(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object' || !('conversationId' in detail) || typeof detail.conversationId !== 'string') return null;
  const state = stateFor(detail.conversationId);
  state.mutationVersion += 1;
  state.clearVersion += 1;
  state.items = [];
  return detail.conversationId;
}

export function __resetComposerInputHistoryForTests(): void {
  histories.clear();
}

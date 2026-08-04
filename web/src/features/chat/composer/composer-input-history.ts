import { fetchJson } from '@/lib/fetch';

export const COMPOSER_INPUT_HISTORY_MAX = 100;

export type ComposerInputHistoryItem = {
  id: number;
  text: string;
  createdAt: number;
};

let items: ComposerInputHistoryItem[] = [];
let loadPromise: Promise<void> | null = null;
let loaded = false;
let writeQueue = Promise.resolve();
let mutationVersion = 0;

function prepend(item: ComposerInputHistoryItem): void {
  if (items[0]?.text === item.text) {
    if (item.id > 0) items[0] = item;
    return;
  }
  items = [item, ...items].slice(0, COMPOSER_INPUT_HISTORY_MAX);
}

function reconcileServerItem(item: ComposerInputHistoryItem): void {
  const optimisticIndex = items.findIndex((entry) => entry.id === 0 && entry.text === item.text);
  if (optimisticIndex >= 0) {
    items[optimisticIndex] = item;
    return;
  }
  prepend(item);
}

export function getComposerInputHistory(): string[] {
  return items.map((item) => item.text);
}

export function loadComposerInputHistory(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const versionAtStart = mutationVersion;
  let retryAfterMutation = false;
  loadPromise = fetchJson<{ items: ComposerInputHistoryItem[] }>('/api/composer-history')
    .then((response) => {
      if (mutationVersion === versionAtStart) {
        items = response.items.slice(0, COMPOSER_INPUT_HISTORY_MAX);
        loaded = true;
      } else {
        retryAfterMutation = true;
      }
    })
    .catch(() => {})
    .finally(() => {
      loadPromise = null;
      if (retryAfterMutation) {
        void writeQueue.then(() => loadComposerInputHistory(true));
      }
    });
  return loadPromise;
}

/** Update the keypress cache immediately, then persist without blocking the composer. */
export function recordComposerInputHistory(text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  mutationVersion += 1;
  prepend({ id: 0, text: normalized, createdAt: Date.now() });
  writeQueue = writeQueue
    .then(async () => {
      const response = await fetchJson<{ item: ComposerInputHistoryItem }>('/api/composer-history', {
        method: 'POST',
        body: JSON.stringify({ text: normalized }),
      });
      reconcileServerItem(response.item);
    })
    .catch(() => {});
}

export function applyComposerHistoryAppended(detail: unknown): void {
  if (!detail || typeof detail !== 'object') return;
  const candidate = detail as Partial<ComposerInputHistoryItem>;
  if (typeof candidate.id !== 'number' || typeof candidate.text !== 'string' || typeof candidate.createdAt !== 'number') {
    return;
  }
  mutationVersion += 1;
  reconcileServerItem({ id: candidate.id, text: candidate.text, createdAt: candidate.createdAt });
}

export function applyComposerHistoryCleared(): void {
  mutationVersion += 1;
  items = [];
}

export function __resetComposerInputHistoryForTests(): void {
  items = [];
  loadPromise = null;
  loaded = false;
  writeQueue = Promise.resolve();
  mutationVersion = 0;
}

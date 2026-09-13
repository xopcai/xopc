import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'storeClient' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));

import { KEYS, type KeyValueStorage } from '../../../storage/mmkv';
import { createChatSelectionStore, EMPTY_CHAT_SELECTION } from '../chat-selection-store';

function memoryStorage(): KeyValueStorage {
  const memory = new Map<string, string>();
  return { getString: key => memory.get(key), set: (key, value) => { memory.set(key, String(value)); }, delete: key => { memory.delete(key); } };
}

describe('last chat selection', () => {
  it('restores the latest selection synchronously after a process restart, independently per gateway', () => {
    const kv = memoryStorage();
    const first = createChatSelectionStore(kv);
    first.getState().select('a', 'previous');
    first.getState().select('b', 'other-gateway');
    first.getState().select('a', 'latest');
    const restarted = createChatSelectionStore(kv);
    expect(restarted.getState().selections.a.key).toBe('latest');
    expect(restarted.getState().selections.b.key).toBe('other-gateway');
  });

  it('invalidates old asynchronous work even when a user selects the same key again', () => {
    const state = createChatSelectionStore(memoryStorage());
    const before = state.getState().select('a', 'current');
    state.getState().beginSelection('a');
    expect(state.getState().selectIfCurrent('a', before, 'late-response')).toBe(false);
    const request = state.getState().beginSelection('a');
    state.getState().select('a', 'chosen');
    expect(state.getState().selectIfCurrent('a', request, 'late-create')).toBe(false);
    expect(state.getState().selections.a.key).toBe('chosen');
  });

  it('clears only the invalid selection and persists the removal', () => {
    const kv = memoryStorage();
    const state = createChatSelectionStore(kv);
    const old = state.getState().select('a', 'deleted');
    state.getState().select('b', 'keep');
    expect(state.getState().selectIfCurrent('a', old, '')).toBe(true);
    expect(createChatSelectionStore(kv).getState().selections).toEqual({ b: { key: 'keep', revision: 0 } });
  });

  it('ignores corrupt storage and can select from an empty state', () => {
    const kv = memoryStorage();
    kv.set(KEYS.lastChatSessionByGateway, 'invalid JSON');
    const state = createChatSelectionStore(kv);
    expect(state.getState().selections).toEqual({});
    expect(state.getState().selectIfCurrent('a', EMPTY_CHAT_SELECTION, 'new')).toBe(true);
  });
});

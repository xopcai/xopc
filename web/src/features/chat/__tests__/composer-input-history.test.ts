// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetComposerInputHistoryForTests,
  applyComposerHistoryAppended,
  COMPOSER_INPUT_HISTORY_MAX,
  getComposerInputHistory,
  loadComposerInputHistory,
  recordComposerInputHistory,
} from '@/features/chat/composer/composer-input-history';

beforeEach(() => {
  __resetComposerInputHistoryForTests();
  vi.restoreAllMocks();
});

describe('composer-input-history', () => {
  it('loads the global history from the gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: 2, text: 'new', createdAt: 2 }, { id: 1, text: 'old', createdAt: 1 }],
    }), { status: 200 })));
    await loadComposerInputHistory();
    expect(getComposerInputHistory()).toEqual(['new', 'old']);
  });

  it('updates memory synchronously and persists in the background', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      item: { id: 1, text: 'hello', createdAt: 1 }, inserted: true,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    recordComposerInputHistory('  hello  ');
    expect(getComposerInputHistory()).toEqual(['hello']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it('deduplicates only the current head', () => {
    applyComposerHistoryAppended({ id: 1, text: 'a', createdAt: 1 });
    applyComposerHistoryAppended({ id: 2, text: 'b', createdAt: 2 });
    applyComposerHistoryAppended({ id: 3, text: 'a', createdAt: 3 });
    applyComposerHistoryAppended({ id: 3, text: 'a', createdAt: 3 });
    expect(getComposerInputHistory()).toEqual(['a', 'b', 'a']);
  });

  it('does not reorder newer optimistic input when an older acknowledgement arrives', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_input, init?: RequestInit) => {
      const text = JSON.parse(String(init?.body)) as { text: string };
      return new Response(JSON.stringify({
        item: { id: text.text === 'a' ? 1 : 2, text: text.text, createdAt: 1 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    recordComposerInputHistory('a');
    recordComposerInputHistory('b');
    applyComposerHistoryAppended({ id: 1, text: 'a', createdAt: 1 });
    expect(getComposerInputHistory()).toEqual(['b', 'a']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it(`caps the in-memory cache at ${COMPOSER_INPUT_HISTORY_MAX}`, () => {
    for (let i = 0; i < 110; i++) {
      applyComposerHistoryAppended({ id: i + 1, text: `m${i}`, createdAt: i });
    }
    expect(getComposerInputHistory()).toHaveLength(COMPOSER_INPUT_HISTORY_MAX);
    expect(getComposerInputHistory()[0]).toBe('m109');
  });

  it('does not read or write localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    applyComposerHistoryAppended({ id: 1, text: 'a', createdAt: 1 });
    expect(getComposerInputHistory()).toEqual(['a']);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

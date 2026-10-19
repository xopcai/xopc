// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetComposerInputHistoryForTests,
  applyComposerHistoryAppended,
  applyComposerHistoryCleared,
  COMPOSER_INPUT_HISTORY_MAX,
  getComposerInputHistory,
  loadComposerInputHistory,
  recordComposerInputHistory,
} from '@/features/chat/composer/composer-input-history';

const A = 'session-a';
const B = 'session-b';

beforeEach(() => {
  __resetComposerInputHistoryForTests();
  vi.restoreAllMocks();
});

describe('composer-input-history', () => {
  it('loads the session history from the gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ conversationId: A, id: 2, text: 'new', createdAt: 2 }, { conversationId: A, id: 1, text: 'old', createdAt: 1 }],
    }), { status: 200 })));
    await loadComposerInputHistory(A);
    expect(getComposerInputHistory(A)).toEqual(['new', 'old']);
  });

  it('updates memory synchronously and persists in the background', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      item: { conversationId: A, id: 1, text: 'hello', createdAt: 1 }, inserted: true,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    recordComposerInputHistory(A, '  hello  ');
    expect(getComposerInputHistory(A)).toEqual(['hello']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it('deduplicates only the current head', () => {
    applyComposerHistoryAppended({ conversationId: A, id: 1, text: 'a', createdAt: 1 });
    applyComposerHistoryAppended({ conversationId: A, id: 2, text: 'b', createdAt: 2 });
    applyComposerHistoryAppended({ conversationId: A, id: 3, text: 'a', createdAt: 3 });
    applyComposerHistoryAppended({ conversationId: A, id: 3, text: 'a', createdAt: 3 });
    expect(getComposerInputHistory(A)).toEqual(['a', 'b', 'a']);
  });

  it('does not reorder newer optimistic input when an older acknowledgement arrives', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_input, init?: RequestInit) => {
      const text = JSON.parse(String(init?.body)) as { text: string };
      return new Response(JSON.stringify({
        item: { conversationId: A, id: text.text === 'a' ? 1 : 2, text: text.text, createdAt: 1 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    recordComposerInputHistory(A, 'a');
    recordComposerInputHistory(A, 'b');
    applyComposerHistoryAppended({ conversationId: A, id: 1, text: 'a', createdAt: 1 });
    expect(getComposerInputHistory(A)).toEqual(['b', 'a']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it(`caps the in-memory cache at ${COMPOSER_INPUT_HISTORY_MAX}`, () => {
    for (let i = 0; i < 110; i++) {
      applyComposerHistoryAppended({ conversationId: A, id: i + 1, text: `m${i}`, createdAt: i });
    }
    expect(getComposerInputHistory(A)).toHaveLength(COMPOSER_INPUT_HISTORY_MAX);
    expect(getComposerInputHistory(A)[0]).toBe('m109');
  });

  it('isolates late loads and realtime append/clear events by session', async () => {
    let resolveA!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('session-a')
      ? new Promise<Response>(resolve => { resolveA = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ items: [{ conversationId: B, id: 2, text: 'b', createdAt: 2 }] })))));
    const loadingA = loadComposerInputHistory(A);
    await loadComposerInputHistory(B);
    resolveA(new Response(JSON.stringify({ items: [{ conversationId: A, id: 1, text: 'a', createdAt: 1 }] })));
    await loadingA;
    applyComposerHistoryAppended({ conversationId: A, id: 3, text: 'a2', createdAt: 3 });
    expect(getComposerInputHistory(A)).toEqual(['a2', 'a']);
    expect(getComposerInputHistory(B)).toEqual(['b']);
    applyComposerHistoryCleared({ conversationId: A });
    expect(getComposerInputHistory(A)).toEqual([]);
    expect(getComposerInputHistory(B)).toEqual(['b']);
    applyComposerHistoryAppended({ id: 9, text: 'legacy', createdAt: 9 });
    applyComposerHistoryCleared({ cleared: 1 });
    expect(getComposerInputHistory(B)).toEqual(['b']);
  });

  it('captures each write target while another session is active', async () => {
    const writes: { conversationId: string; text: string }[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      return new Response(JSON.stringify({ item: { ...body, id: writes.length, createdAt: 1 } }));
    }));
    recordComposerInputHistory(A, 'first a');
    recordComposerInputHistory(B, 'first b');
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual(expect.arrayContaining([{ conversationId: A, text: 'first a' }, { conversationId: B, text: 'first b' }]));
    expect(getComposerInputHistory(A)).toEqual(['first a']);
    expect(getComposerInputHistory(B)).toEqual(['first b']);
  });

  it('does not read or write localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    applyComposerHistoryAppended({ conversationId: A, id: 1, text: 'a', createdAt: 1 });
    expect(getComposerInputHistory(A)).toEqual(['a']);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

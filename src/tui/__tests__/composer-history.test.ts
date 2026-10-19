import { describe, expect, it, vi } from 'vitest';

import { createTuiComposerHistory } from '../composer-history.js';
import type { TuiComposerHistoryItem } from '../tui-backend.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const item = (conversationId: string, text = conversationId, id = 1): TuiComposerHistoryItem => ({ conversationId, id, text, createdAt: id });

function harness() {
  let current = 'a';
  const replace = vi.fn();
  const load = vi.fn<(id: string) => Promise<TuiComposerHistoryItem[]>>().mockResolvedValue([]);
  const persist = vi.fn<(id: string, text: string) => Promise<TuiComposerHistoryItem>>().mockImplementation(async (id, text) => item(id, text));
  const history = createTuiComposerHistory({ currentConversationId: () => current, load, persist, replace });
  return { history, load, persist, replace, switchTo: (id: string) => { current = id; history.switchSession(); } };
}

describe('TUI session composer history', () => {
  it('clears the previous editor history immediately and ignores its late load', async () => {
    const h = harness();
    const old = deferred<TuiComposerHistoryItem[]>();
    h.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce([item('b')]);
    const loading = h.history.refresh();
    await Promise.resolve();
    h.switchTo('b');
    expect(h.replace).toHaveBeenLastCalledWith([]);
    await vi.waitFor(() => expect(h.replace).toHaveBeenLastCalledWith(['b']));
    old.resolve([item('a')]);
    await loading;
    expect(h.replace).toHaveBeenLastCalledWith(['b']);
  });

  it('keeps pending writes, acknowledgements, and realtime events in their originating session', async () => {
    const h = harness();
    const ack = deferred<TuiComposerHistoryItem>();
    h.persist.mockReturnValueOnce(ack.promise);
    h.history.record('first a');
    await Promise.resolve();
    h.switchTo('b');
    await h.history.refresh('b');
    h.history.append(item('b', 'first b', 2));
    const calls = h.replace.mock.calls.length;
    h.history.append(item('a', 'other a', 3));
    ack.resolve(item('a', 'first a'));
    await vi.waitFor(() => expect(h.persist).toHaveBeenCalledWith('a', 'first a'));
    await h.history.refresh('a');
    expect(h.replace).toHaveBeenCalledTimes(calls);
    h.history.clear('a');
    expect(h.replace).toHaveBeenCalledTimes(calls);
  });

  it('does not let an earlier load override a later load after switching A to B to A', async () => {
    const h = harness();
    const old = deferred<TuiComposerHistoryItem[]>();
    h.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]).mockResolvedValueOnce([item('a', 'new')]);
    const first = h.history.refresh();
    await Promise.resolve();
    h.switchTo('b');
    await Promise.resolve();
    h.switchTo('a');
    await vi.waitFor(() => expect(h.replace).toHaveBeenLastCalledWith(['new']));
    old.resolve([item('a', 'old')]);
    await first;
    expect(h.replace).toHaveBeenLastCalledWith(['new']);
  });

  it('records the first input against the newly selected session and accepts an explicit queued-input target', async () => {
    const h = harness();
    h.switchTo('created');
    h.history.record('first');
    h.history.record('queued a', 'a');
    await vi.waitFor(() => expect(h.persist).toHaveBeenCalledWith('created', 'first'));
    expect(h.persist).toHaveBeenCalledWith('a', 'queued a');
  });
});

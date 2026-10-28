// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useInitialTurnNavigation } from '../use-initial-turn-navigation';

const reveal = vi.fn(() => true);
const located = vi.fn();
const loadMore = vi.fn(async () => {});
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Reader({ ids, hasMore = false, turnId = 'target' }: { ids: string[]; hasMore?: boolean; turnId?: string }) {
  useInitialTurnNavigation({ conversationId: 'shared-conversation', turnId,
    messages: ids.map(id => ({ turnId: id })), ready: true, hasMore, loadingMore: false, loadMore, reveal, onLocated: located });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const render = (ids: string[], hasMore = false, turnId = 'target') => act(async () => root.render(<Reader ids={ids} hasMore={hasMore} turnId={turnId} />));

it('reveals the selected persisted turn once and does not jump again when new messages arrive', async () => {
  await render(['previous', 'target', 'later']);
  expect(reveal).toHaveBeenCalledWith(1); expect(located).toHaveBeenCalledWith(true);
  await render(['previous', 'target', 'later', 'newest']);
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(loadMore).not.toHaveBeenCalled();
});
it('loads older history before locating the selected run by identity', async () => {
  await render(['newest'], true);
  expect(loadMore).toHaveBeenCalledTimes(1); expect(located).not.toHaveBeenCalled();
  await render(['older', 'target', 'newest'], true);
  expect(reveal).toHaveBeenCalledWith(1); expect(located).toHaveBeenCalledWith(true);
});
it('reports missing legacy turn identities instead of guessing from message order or time', async () => {
  await render(['other']);
  expect(located).toHaveBeenCalledWith(false); expect(reveal).not.toHaveBeenCalled();
});
it('stops when an older history page makes no progress', async () => {
  await render(['newest'], true);
  await render(['newest'], true);
  expect(loadMore).toHaveBeenCalledTimes(1); expect(located).toHaveBeenCalledWith(false);
});
it('locates a different selected run even when it shares the same conversation', async () => {
  await render(['target', 'other']);
  await render(['target', 'other'], false, 'other');
  expect(reveal.mock.calls).toEqual([[0], [1]]);
});

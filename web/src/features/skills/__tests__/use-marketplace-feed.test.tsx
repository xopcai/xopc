// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMarketplaceSkills } from '@/features/skills/skill-api';
import { useMarketplaceFeed } from '@/features/skills/use-marketplace-feed';

vi.mock('@/features/skills/skill-api', () => ({ getMarketplaceSkills: vi.fn() }));
let feed: ReturnType<typeof useMarketplaceFeed>;
function Harness({ category = '' }: { category?: string }) {
  feed = useMarketplaceFeed({ enabled: true, provider: 'store', category, sort: 'downloads' });
  return null;
}
function page(number: number, ids: string[], totalPages = 2) {
  return { items: ids.map((id) => ({ id, name: id })), meta: { page: number, pageSize: 20, total: 40, totalPages } } as Awaited<ReturnType<typeof getMarketplaceSkills>>;
}

describe('marketplace infinite feed', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let cache: Map<string, never>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    cache = new Map<string, never>();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  async function render(category = '') {
    await act(async () => root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Harness category={category} /></SWRConfig>));
  }
  it('appends and deduplicates pages, coalesces repeated load requests, and stops at the end', async () => {
    vi.mocked(getMarketplaceSkills).mockResolvedValueOnce(page(1, ['a', 'b'])).mockResolvedValueOnce(page(2, ['b', 'c']));
    await render();
    expect(feed.payload?.items.map((item) => item.id)).toEqual(['a', 'b']);
    await act(async () => { feed.loadMore(); feed.loadMore(); });
    expect(feed.payload?.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(getMarketplaceSkills).toHaveBeenCalledTimes(2);
    expect(feed.hasMore).toBe(false);
    await act(async () => feed.loadMore());
    expect(getMarketplaceSkills).toHaveBeenCalledTimes(2);
  });
  it('keeps loaded cards after an error and retries the missing page', async () => {
    vi.mocked(getMarketplaceSkills).mockResolvedValueOnce(page(1, ['a'])).mockRejectedValueOnce(new Error('offline'));
    await render();
    await act(async () => feed.loadMore());
    expect(feed.payload?.items[0].id).toBe('a');
    expect(feed.error.message).toBe('offline');
    await act(async () => feed.loadMore());
    expect(getMarketplaceSkills).toHaveBeenCalledTimes(2);
    vi.mocked(getMarketplaceSkills).mockImplementation(async ({ page: number }) => page(number!, [number === 1 ? 'a' : 'b']));
    await act(async () => feed.retry());
    expect(feed.error).toBeUndefined();
    expect(feed.payload?.items.map((item) => item.id)).toEqual(['a', 'b']);
  });
  it('resets on a category change and ignores a late response from the old category', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void;
    vi.mocked(getMarketplaceSkills)
      .mockResolvedValueOnce(page(1, ['old']))
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce(page(1, ['new'], 1));
    await render();
    await act(async () => feed.loadMore());
    await render('new-category');
    expect(feed.payload?.items.map((item) => item.id)).toEqual(['new']);
    await act(async () => resolve(page(2, ['late'])));
    expect(feed.payload?.items.map((item) => item.id)).toEqual(['new']);
    expect(getMarketplaceSkills).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, category: 'new-category' }));
  });
});

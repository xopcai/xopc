import { describe, expect, it, vi } from 'vitest';
import { bumpSidebarSessionRow, patchSidebarSessionName, upsertSidebarSessionRow } from '@/features/sessions/patch-sidebar-session-meta';
import type { SessionMetadata } from '@/features/sessions/session.types';

const ID = '402d49db-7bd4-4cdd-9ba1-a8e16de1f061';
const OTHER = '402d49db-7bd4-4cdd-9ba1-a8e16de1f062';
function session(key: string): SessionMetadata {
  return { key, agentId: 'coder', status: 'active', tags: [], createdAt: '2026-01-01',
    updatedAt: '2026-01-01', lastAccessedAt: '2026-01-01', messageCount: 0,
    estimatedTokens: 0, compactedCount: 0, sourceChannel: 'webchat', sourceChatId: 'peer' };
}
type Pages = { items: SessionMetadata[]; hasMore: boolean }[];
function cache(items?: SessionMetadata[]) {
  let pages: Pages | undefined = items ? [{ items, hasMore: false }] : undefined;
  const mutate = vi.fn(async (update?: Pages | ((pages?: Pages) => Pages | undefined)) => {
    if (typeof update === 'function') pages = update(pages);
    return pages;
  });
  return { mutate, read: () => pages };
}

describe('sidebar conversation metadata', () => {
  it('keeps an unloaded cache available for the initial fetch', async () => {
    const c = cache();
    upsertSidebarSessionRow(c.mutate, ID);
    await Promise.resolve();
    expect(c.read()).toBeUndefined();
  });
  it('moves a known conversation while preserving its authoritative agent and route', async () => {
    const c = cache([session(OTHER), session(ID)]);
    bumpSidebarSessionRow(c.mutate, ID, { name: 'New title' });
    await Promise.resolve();
    expect(c.read()?.[0].items[0]).toMatchObject({ key: ID, agentId: 'coder', sourceChatId: 'peer', name: 'New title' });
    expect(c.read()?.[0].items).toHaveLength(2);
  });
  it('patches an existing title in place', async () => {
    const c = cache([session(OTHER), session(ID)]);
    patchSidebarSessionName(c.mutate, ID, 'Renamed');
    await Promise.resolve();
    expect(c.read()?.[0].items[1].name).toBe('Renamed');
  });
  it.each([upsertSidebarSessionRow, patchSidebarSessionName])('fetches missing metadata instead of guessing an agent from the ID', async (patch) => {
    const c = cache([session(OTHER)]);
    if (patch === patchSidebarSessionName) patchSidebarSessionName(c.mutate, ID, 'Title');
    else upsertSidebarSessionRow(c.mutate, ID, { name: 'Title' });
    await Promise.resolve();
    expect(c.mutate).toHaveBeenLastCalledWith();
    expect(c.read()?.[0].items).toEqual([session(OTHER)]);
  });
});

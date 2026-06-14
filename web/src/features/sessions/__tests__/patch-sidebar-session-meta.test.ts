import { describe, expect, it } from 'vitest';

import {
  bumpSidebarSessionRow,
  patchSidebarSessionName,
  upsertSidebarSessionRow,
} from '@/features/sessions/patch-sidebar-session-meta';
import type { SessionMetadata } from '@/features/sessions/session.types';

const KEY = 'agent:main:webchat:default:direct:chat_test';

function stub(key: string, updatedAt: string): SessionMetadata {
  return {
    key,
    status: 'active',
    tags: [],
    createdAt: updatedAt,
    updatedAt,
    lastAccessedAt: updatedAt,
    messageCount: 0,
    estimatedTokens: 0,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'chat_test',
  };
}

type Pages = { items: SessionMetadata[]; hasMore: boolean }[];

describe('upsertSidebarSessionRow', () => {
  it('no-ops when cache is empty (does not block server fetch)', async () => {
    let pages: Pages | undefined;
    const mutate = async (
      updater?: Pages | ((p?: Pages) => Pages | undefined),
    ) => {
      if (typeof updater === 'function') {
        pages = updater(pages);
      }
      return pages;
    };

    upsertSidebarSessionRow(mutate, KEY, { name: 'Hello' });
    await Promise.resolve();

    expect(pages).toBeUndefined();
  });

  it('moves an existing session to the top when cache is loaded', async () => {
    let pages: Pages = [
      {
        items: [stub('agent:main:webchat:default:direct:other', '2026-01-01T00:00:00.000Z')],
        hasMore: false,
      },
    ];
    const mutate = async (
      updater?: Pages | ((p?: Pages) => Pages | undefined),
    ) => {
      if (typeof updater === 'function') {
        pages = updater(pages) ?? pages;
      }
      return pages;
    };

    upsertSidebarSessionRow(mutate, KEY, { name: 'New chat title' });
    await Promise.resolve();

    expect(pages[0]?.items[0]?.key).toBe(KEY);
    expect(pages[0]?.items[0]?.name).toBe('New chat title');
  });
});

describe('patchSidebarSessionName', () => {
  it('updates name on an existing row', async () => {
    let pages: Pages = [{ items: [stub(KEY, '2026-01-01T00:00:00.000Z')], hasMore: false }];
    const mutate = async (
      updater?: Pages | ((p?: Pages) => Pages | undefined),
    ) => {
      if (typeof updater === 'function') {
        pages = updater(pages) ?? pages;
      }
      return pages;
    };

    patchSidebarSessionName(mutate, KEY, 'From user message');
    await Promise.resolve();

    expect(pages[0]?.items[0]?.name).toBe('From user message');
  });
});

describe('bumpSidebarSessionRow', () => {
  it('delegates to upsert when cache exists', async () => {
    let pages: Pages = [{ items: [], hasMore: true }];
    const mutate = async (
      updater?: Pages | ((p?: Pages) => Pages | undefined),
    ) => {
      if (typeof updater === 'function') {
        pages = updater(pages) ?? pages;
      }
      return pages;
    };

    bumpSidebarSessionRow(mutate, KEY, { name: 'Hi' });
    await Promise.resolve();

    expect(pages[0]?.items[0]?.key).toBe(KEY);
  });
});

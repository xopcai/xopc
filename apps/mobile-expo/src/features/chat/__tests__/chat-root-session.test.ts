import { describe, expect, it } from 'vitest';

import type { SessionListItem } from '../../../query/sessions';
import { resumableRootChatSessions, rootChatResumeKey, rootChatLookupComplete } from '../chat-root-session';

function session(key: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  return { key, messageCount: 1, updatedAt: '2026-09-10T00:00:00.000Z', ...overrides };
}

describe('root chat resume', () => {
  it('only accepts a successful fresh lookup, not placeholders, stale cache or errors', () => {
    const ready = { isSuccess: true, isPlaceholderData: false, isFetchedAfterMount: true, isFetching: false };
    expect(rootChatLookupComplete(ready)).toBe(true);
    expect(rootChatLookupComplete({ ...ready, isPlaceholderData: true, isFetching: true })).toBe(false);
    expect(rootChatLookupComplete({ ...ready, isFetchedAfterMount: false })).toBe(false);
    expect(rootChatLookupComplete({ ...ready, isSuccess: false })).toBe(false);
  });
  it('resumes the latest usable web chat', () => {
    const items = [
      session('archived', { status: 'archived' }),
      session('telegram', { sourceChannel: 'telegram' }),
      session('webchat', { sourceChannel: 'webchat' }),
    ];
    expect(rootChatResumeKey(items)).toBe('webchat');
  });

  it('excludes rows without explicit web chat source metadata', () => {
    expect(resumableRootChatSessions([session('unknown')])).toEqual([]);
  });
});

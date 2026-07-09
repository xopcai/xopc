import { describe, expect, it } from 'vitest';

import {
  buildSessionListPath,
  parseSessionsListResponse,
  sessionListDedupeKey,
  tryParseSessionListItem,
} from './sessions.js';

describe('sessions contract', () => {
  it('builds list paths with gateway query names', () => {
    expect(
      buildSessionListPath({
        search: 'hello',
        channel: 'webchat',
        includePinned: true,
        sessionTypes: ['chat', 'workflow'],
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: 20,
        offset: 40,
      }),
    ).toBe('/api/sessions?search=hello&channel=webchat&includePinned=true&types=chat%2Cworkflow&sortBy=updatedAt&sortOrder=desc&limit=20&offset=40');
  });

  it('omits null channels for callers that intentionally request all channels', () => {
    expect(buildSessionListPath({ channel: null, limit: 10 })).toBe('/api/sessions?limit=10');
  });

  it('uses stable dedupe keys for identical list queries', () => {
    const query = { search: 'hello', limit: 20, offset: 0 };
    expect(sessionListDedupeKey(query)).toBe(sessionListDedupeKey({ ...query }));
  });

  it('parses paginated session lists without rejecting extra row fields', () => {
    const parsed = parseSessionsListResponse({
      items: [
        {
          key: 'webchat:default:direct:chat_1',
          name: 'Chat',
          messageCount: 1,
          updatedAt: '2026-07-09T00:00:00.000Z',
          custom: true,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
    expect(parsed.total).toBe(1);
    expect(tryParseSessionListItem(parsed.items[0])?.name).toBe('Chat');
  });
});

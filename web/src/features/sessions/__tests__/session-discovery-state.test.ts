import { buildSessionListPath, sessionListDedupeKey } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { buildDiscoveryQuery, DEFAULT_SESSION_FILTERS, hasSessionFilters } from '../session-discovery-state';

describe('session discovery query', () => {
  it('searches all time without pinned or current-session exceptions', () => {
    const query = buildDiscoveryQuery(DEFAULT_SESSION_FILTERS, ' older conversation ');
    expect(query.search).toBe('older conversation');
    expect(query.updatedAfter).toBeUndefined();
    expect(query.includePinned).toBeUndefined();
    expect(query.includeSessionKey).toBeUndefined();
    expect(query.excludeArchived).toBe(true);
    expect(query.purposes).toContain('system');
  });
  it('encodes every filter in the HTTP request and request dedupe key', () => {
    const query = buildDiscoveryQuery({ ...DEFAULT_SESSION_FILTERS, sources: ['terminal', 'browser'], purposes: ['chat'], project: '__unassigned', days: '7', agentId: 'coder' }, '', 10 * 86_400_000);
    const url = new URL(buildSessionListPath(query), 'http://localhost');
    expect(url.searchParams.get('sources')).toBe('terminal,browser');
    expect(url.searchParams.get('purposes')).toBe('chat');
    expect(url.searchParams.get('unassigned')).toBe('true');
    expect(url.searchParams.get('agentId')).toBe('coder');
    expect(query.updatedAfter).toBe(3 * 86_400_000);
    expect(sessionListDedupeKey(query)).not.toBe(sessionListDedupeKey({ ...query, sources: ['browser'] }));
  });
  it('does not enter search mode for the source-description preference alone', () => {
    expect(hasSessionFilters({ ...DEFAULT_SESSION_FILTERS, details: true })).toBe(false);
    expect(hasSessionFilters({ ...DEFAULT_SESSION_FILTERS, activity: 'automatic' })).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeXopcDatabase, openXopcDatabase } from '../connection.js';
import { createConversation, requireConversation, resolveRoutedConversation } from '../conversation-repository.js';
import { resetSessionRecord } from '../session-repository.js';

beforeEach(() => openXopcDatabase({ path: ':memory:' }));
afterEach(() => closeXopcDatabase());

describe('conversation identity', () => {
  it('keeps identity and routing stable across reset', () => {
    const route = { agentId: 'coder', source: 'telegram', peerKind: 'direct' as const, peerId: '123' };
    const id = resolveRoutedConversation(route);
    const first = requireConversation(id);
    expect(first.agentId).toBe('coder');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRoutedConversation(route)).toBe(id);
    resetSessionRecord(id, '/workspace');
    const second = requireConversation(id);
    expect(second.transcriptId).not.toBe(first.transcriptId);
    expect(resolveRoutedConversation(route)).toBe(id);
  });

  it('creates independent manual conversations and rejects unknown identifiers', () => {
    const first = createConversation({ agentId: 'coder' });
    const second = createConversation({ agentId: 'coder' });
    expect(first.key).not.toBe(second.key);
    expect(() => requireConversation('agent:coder:main')).toThrow();
    expect(() => requireConversation('00000000-0000-4000-8000-000000000000')).toThrow(/not found/);
    expect(() => createConversation({ agentId: 'other' }, '', first.key)).toThrow(/already exists/);
  });
});

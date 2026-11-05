import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { createBrowserSession, deleteBrowserSession } from '../../storage/sqlite/browser-session-repository.js';
import { requireXopcDatabase } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, insertSessionInput, finishSessionInputRun } from '../../storage/sqlite/session-input-repository.js';
import { currentDeviceExecutionActor, recordDeviceExecutionActor } from '../execution-actor.js';

beforeEach(() => { requireXopcDatabase(); });

describe('authenticated device execution identity', () => {
  it('shares the owner execution identity across browser sessions while rejecting a logged-out input', () => {
    const conversationId = createConversation({ agentId: 'main' }).key;
    const session = createBrowserSession({ mode: 'token', token: 'fixture-owner-token' });
    recordDeviceExecutionActor(conversationId, 'browser-message', { kind: 'owner', principalId: `browser:${session.sessionId}`,
      browserSessionId: session.sessionId, scopes: ['gateway.admin'] });
    insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'browser-message', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Continue on the selected device', origin: { type: 'system', source: 'cli' } });
    claimNextSessionInput(conversationId, 'browser-run');
    expect(currentDeviceExecutionActor(conversationId)?.principalId).toBe('gateway-owner');
    deleteBrowserSession(session.sessionId);
    expect(currentDeviceExecutionActor(conversationId)).toBeUndefined();
  });

  it('uses the executing input rather than the latest queued message', () => {
    const conversationId = randomUUID();
    createConversation({ agentId: 'main' }, '', conversationId);
    const owner = { kind: 'owner' as const, principalId: 'owner-a', scopes: ['gateway.admin' as const] };
    recordDeviceExecutionActor(conversationId, 'first-message', owner);
    insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'first-message', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Use the Mac', origin: { type: 'system', source: 'cli' } });
    claimNextSessionInput(conversationId, 'first-run');
    recordDeviceExecutionActor(conversationId, 'second-message', { ...owner, principalId: 'owner-b' });
    insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'second-message', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Another task', origin: { type: 'system', source: 'cli' } });
    expect(currentDeviceExecutionActor(conversationId)?.principalId).toBe('owner-a');
    expect(currentDeviceExecutionActor(conversationId, 'unknown-run')).toBeUndefined();
    finishSessionInputRun(conversationId, 'first-run', 'completed');
    claimNextSessionInput(conversationId, 'second-run');
    expect(currentDeviceExecutionActor(conversationId, 'second-run')?.principalId).toBe('owner-b');
    expect(() => recordDeviceExecutionActor(conversationId, 'first-message', { ...owner, principalId: 'owner-b' })).toThrow('another principal');
  });
  it('does not invent an owner identity for an automation or unrecorded input', () => {
    const conversationId = randomUUID();
    createConversation({ agentId: 'main' }, '', conversationId);
    insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'automation', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Run', origin: { type: 'system', source: 'automation' } });
    claimNextSessionInput(conversationId, 'automation-run');
    expect(currentDeviceExecutionActor(conversationId)).toBeUndefined();
  });
});

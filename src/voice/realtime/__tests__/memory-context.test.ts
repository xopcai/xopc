import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import type { ExecutionContext } from '../../../agent/context/execution-context.types.js';
import { ConfigSchema } from '../../../config/schema.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { notifyUserContextChange } from '../../../user-context/changes.js';
import { applyUserProfilePatch } from '../../../user-model/profile.js';
import { getUserAssertion, listUserAssertions, setAssertionStatus } from '../../../user-model/repository.js';
import { buildVoiceMemoryContext } from '../memory-context.js';

const retrieval = vi.hoisted(() => vi.fn());
vi.mock('../../../agent/context/execution-context.js', () => ({ buildExecutionContext: retrieval }));

let conversationId: string;
let context: ExecutionContext;
beforeEach(() => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
  const agentId = personalAgentId('local-owner'); catalog.create({ id: agentId }, { ready: true });
  conversationId = createConversation({ agentId, sourceChannel: 'webchat', sourceChatId: '' }).key;
  context = { traceId: 'test', asOf: Date.now(), query: '', rules: [], assertions: [], goals: [], priorities: [], knowledge: [], externalKnowledge: [] };
  retrieval.mockImplementation(() => context);
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.clearAllMocks(); });

function build(maxChars = 400) {
  return buildVoiceMemoryContext({ getConfig: () => ConfigSchema.parse({}), conversationId, workspaceId: '/workspace', history: [], maxChars });
}

describe('bounded native voice memory', () => {
  it('uses the canonical Agent id even when routing JSON is empty', () => {
    build();
    expect(retrieval).toHaveBeenCalledWith(expect.objectContaining({ agentId: personalAgentId('local-owner') }));
  });

  it('keeps fitting facts when another retrieved item exceeds the budget and tracks only included sources', () => {
    applyUserProfilePatch({ callName: 'Alice', role: 'Engineer' });
    const rows = listUserAssertions({ statuses: ['active'] });
    const name = rows.find(item => item.statement.includes('Alice'))!;
    const role = rows.find(item => item.statement.includes('Engineer'))!;
    context.assertions = [
      { assertion: { ...role, statement: 'x'.repeat(5000) }, usage: 'confirmed', score: 1, reasons: [] },
      { assertion: name, usage: 'confirmed', score: 0.5, reasons: [] },
    ];
    const snapshot = build()!;
    expect(snapshot.block.length).toBeLessThanOrEqual(400);
    expect(JSON.parse(snapshot.block).backgroundMemory).toMatchObject({ confirmedFacts: ['Prefers to be called Alice.'], omittedItems: 1 });
    expect(snapshot.references.map(item => item.id)).toEqual([name.id]);
    expect(snapshot.isCurrent()).toBe(true);
    setAssertionStatus(name.id, 'archived', { actor: 'user', reason: 'No longer shared.' });
    expect(getUserAssertion(name.id)?.status).toBe('archived');
    expect(snapshot.isCurrent()).toBe(false);
  });

  it('keeps assumptions distinct from confirmed facts', () => {
    applyUserProfilePatch({ callName: 'Alice', role: 'Engineer' });
    const rows = listUserAssertions({ statuses: ['active'] });
    context.assertions = rows.map((assertion, index) => ({ assertion, usage: index ? 'working_assumption' : 'confirmed', score: 1, reasons: [] }));
    const data = JSON.parse(build()!.block).backgroundMemory;
    expect(data.confirmedFacts).toHaveLength(1); expect(data.workingAssumptions).toHaveLength(1);
  });

  it('invalidates promptly when personalization policy changes and releases its subscription', async () => {
    applyUserProfilePatch({ callName: 'Alice' });
    context.assertions = listUserAssertions({ statuses: ['active'] }).map(assertion => ({ assertion, usage: 'confirmed', score: 1, reasons: [] }));
    const invalidate = vi.fn(); const unsubscribe = build()!.subscribe(invalidate);
    notifyUserContextChange({ kind: 'policy' }); await Promise.resolve();
    expect(invalidate).toHaveBeenCalledOnce();
    unsubscribe(); notifyUserContextChange({ kind: 'policy' }); await Promise.resolve();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});

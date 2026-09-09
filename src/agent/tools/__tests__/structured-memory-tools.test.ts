import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { getUserAssertion, reconcileAssertion, type AssertionCandidate } from '../../../user-model/index.js';
import { createKnowledgeWriteTool } from '../knowledge-memory-tool.js';
import {
  createUserContextGetTool,
  createUserContextSearchTool,
  createUserContextUpdateTool,
} from '../user-context-tool.js';

function assertion(overrides: Partial<AssertionCandidate> = {}): AssertionCandidate {
  return {
    subject: { type: 'user', id: 'self' },
    predicate: 'preference.response.detail',
    cardinality: 'single',
    scope: { type: 'global' },
    kind: 'preference',
    value: 'concise',
    normalizedValue: 'concise',
    statement: 'Use concise responses.',
    authority: 'user_explicit',
    confidence: 1,
    inferredImportance: 0.5,
    consequence: 'medium',
    actionability: 1,
    volatility: 'stable',
    sensitivity: 'normal',
    disclosurePolicy: 'referenceable',
    observedAt: 100,
    createdBy: 'user',
    ...overrides,
  };
}

describe('structured memory tools', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('does not expose disabled or non-referenceable user assertions', async () => {
    const secret = reconcileAssertion(assertion({
      predicate: 'identity.secret',
      statement: 'The private code is 1234.',
      normalizedValue: '1234',
      sensitivity: 'secret',
    }), 200).assertion;
    const base = {
      agentId: 'main',
      workspaceId: '/workspace',
      getSessionId: () => 'agent:main:main',
      canRead: () => true,
    };

    const search = await createUserContextSearchTool(base).execute('call-1', { query: 'private code' });
    const get = await createUserContextGetTool(base).execute('call-2', { id: secret.id });
    const disabled = await createUserContextSearchTool({ ...base, canRead: () => false })
      .execute('call-3', { query: 'concise' });

    expect(search.details).toEqual({ results: [] });
    expect(get.details).toEqual({ id: secret.id });
    expect(disabled.details).toEqual({ error: 'user_context_disabled' });
  });

  it('lets the agent immediately correct an existing assertion with explicit user evidence', async () => {
    const inferred = reconcileAssertion(assertion({
      authority: 'system_inferred', confidence: 0.8, createdBy: 'runtime',
      statement: 'Likely prefers long responses.', value: 'long', normalizedValue: 'long',
    }), 200).assertion;
    const options = {
      agentId: 'main', workspaceId: '/workspace', getSessionId: () => 'agent:main:main',
      canRead: () => true, canWrite: () => true,
      getCurrentUserText: () => '不是长回复，我喜欢简洁回答',
    };
    const search = await createUserContextSearchTool(options).execute('search', { query: 'responses' });
    expect(search.details).toMatchObject({
      results: [expect.objectContaining({ id: inferred.id, status: 'candidate' })],
    });

    const update = await createUserContextUpdateTool(options).execute('update', {
      id: inferred.id,
      action: 'correct',
      replacement: 'Prefers concise responses.',
      userEvidence: '不是长回复，我喜欢简洁回答',
    });
    expect(update.details).toMatchObject({
      action: 'corrected',
      assertion: { statement: 'Prefers concise responses.', authority: 'user_explicit', status: 'active' },
      previousAssertionId: inferred.id,
    });
    expect(getUserAssertion(inferred.id)?.validTo).toBeDefined();
  });

  it('blocks user-context updates when write access is unavailable', async () => {
    const current = reconcileAssertion(assertion(), 200).assertion;
    const result = await createUserContextUpdateTool({
      agentId: 'main', workspaceId: '/workspace', getSessionId: () => 'agent:main:main',
      canRead: () => true, canWrite: () => false,
    }).execute('update', { id: current.id, action: 'forget', userEvidence: '忘掉它' });
    expect(result.details).toEqual({ error: 'user_context_update_disabled' });
  });

  it('rejects evidence that is not quoted from the current user message', async () => {
    const current = reconcileAssertion(assertion(), 200).assertion;
    const result = await createUserContextUpdateTool({
      agentId: 'main', workspaceId: '/workspace', getSessionId: () => 'agent:main:main',
      canRead: () => true, canWrite: () => true, getCurrentUserText: () => 'Keep this preference.',
    }).execute('update', { id: current.id, action: 'forget', userEvidence: 'Forget this preference.' });
    expect(result.details).toEqual({ error: 'user_evidence_mismatch' });
  });

  it('applies deny, confirm, allow, and source policies to knowledge writes', async () => {
    let policy: 'deny' | 'confirm' | 'allow' = 'deny';
    let sources: Array<'session' | 'workspace' | 'project' | 'connector'> = ['workspace'];
    const tool = createKnowledgeWriteTool({
      agentId: 'main',
      workspaceId: '/workspace',
      getSessionId: () => 'agent:main:main',
      getProjectId: () => 'project-1',
      canRead: () => true,
      canWrite: () => true,
      getWritePolicy: () => policy,
      getSources: () => sources,
    });
    const input = {
      kind: 'decision',
      content: 'Use SQLite.',
      canonicalKey: 'decision:sqlite',
      scope: 'workspace',
    } as const;

    expect((await tool.execute('deny', input)).details).toEqual({ error: 'knowledge_write_denied' });
    policy = 'confirm';
    expect((await tool.execute('confirm', input)).details).toMatchObject({
      item: { status: 'candidate' },
      writePolicy: 'confirm',
    });
    policy = 'allow';
    expect((await tool.execute('allow', { ...input, canonicalKey: 'decision:active' })).details)
      .toMatchObject({ item: { status: 'active' }, writePolicy: 'allow' });
    sources = ['session'];
    expect((await tool.execute('source', { ...input, canonicalKey: 'decision:blocked' })).details)
      .toEqual({ error: 'knowledge_source_disabled', source: 'workspace' });
  });
});

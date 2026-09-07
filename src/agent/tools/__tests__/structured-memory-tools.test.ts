import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { reconcileAssertion, type AssertionCandidate } from '../../../user-model/index.js';
import { createKnowledgeWriteTool } from '../knowledge-memory-tool.js';
import { createUserContextGetTool, createUserContextSearchTool } from '../user-context-tool.js';

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

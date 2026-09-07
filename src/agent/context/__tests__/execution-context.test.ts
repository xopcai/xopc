import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeKnowledgeItem } from '../../../knowledge-memory/index.js';
import {
  closeXopcDatabase,
  createCollaborationRule,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { reconcileAssertion, type AssertionCandidate } from '../../../user-model/index.js';
import {
  getExecutionContextAudit,
  recordExecutionContext,
  recordExecutionContextFeedback,
} from '../audit.js';
import { buildExecutionContext, evaluateToolGate, renderExecutionContext } from '../execution-context.js';

const request = {
  query: 'prepare the release response',
  agentId: 'main',
  workspaceId: '/workspace',
  projectId: 'project-1',
  sessionId: 'session-1',
  asOf: 1_000,
};

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
    declaredImportance: 0.9,
    inferredImportance: 0.5,
    consequence: 'high',
    actionability: 1,
    volatility: 'stable',
    sensitivity: 'normal',
    disclosurePolicy: 'referenceable',
    observedAt: 100,
    createdBy: 'user',
    ...overrides,
  };
}

describe('execution context', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('combines high-value current assertions with scoped knowledge', () => {
    reconcileAssertion(assertion(), 200);
    writeKnowledgeItem({
      kind: 'decision',
      scope: { type: 'project', id: 'project-1' },
      content: 'The release uses a blue deployment strategy.',
      canonicalKey: 'release:deployment-strategy',
      confidence: 1,
      importance: 0.8,
      originClass: 'owner',
      now: 200,
    });
    writeKnowledgeItem({
      kind: 'decision',
      scope: { type: 'project', id: 'other' },
      content: 'The other release uses a red deployment strategy.',
      canonicalKey: 'other:deployment-strategy',
      confidence: 1,
      importance: 0.8,
      originClass: 'owner',
      now: 200,
    });

    const context = buildExecutionContext(request);
    expect(context.assertions.map((item) => item.assertion.statement)).toContain('Use concise responses.');
    expect(context.knowledge.map((item) => item.content)).toEqual([
      'The release uses a blue deployment strategy.',
    ]);
    expect(renderExecutionContext(context)).toContain('Relevant user facts');
  });

  it('excludes expired assertions at the requested valid time', () => {
    reconcileAssertion(assertion({ validFrom: 100, validTo: 500 }), 200);
    expect(buildExecutionContext({ ...request, asOf: 600 }).assertions).toEqual([]);
  });

  it('enforces explicit tool-gate rules structurally', () => {
    createCollaborationRule({
      category: 'boundary',
      priority: 0,
      scope: { type: 'global' },
      conditions: { enforcementLevel: 'tool_gate', operationTypes: ['external_send'], effect: 'deny' },
      statement: 'Do not send external messages without approval.',
    });
    const context = buildExecutionContext(request);
    expect(evaluateToolGate(context, 'external_send')).toMatchObject({ allowed: false });
    expect(evaluateToolGate(context, 'read_file')).toEqual({ allowed: true });
  });

  it('records selected context and accepts outcome feedback for the turn', () => {
    const reconciled = reconcileAssertion(assertion(), 200);
    const context = buildExecutionContext(request);
    recordExecutionContext(context, {
      turnId: 'turn-1',
      sessionId: request.sessionId,
      budget: { maxAssertions: 20, maxKnowledge: 12, maxChars: 8_000 },
      renderedChars: renderExecutionContext(context).length,
    });

    expect(getExecutionContextAudit('turn-1')).toMatchObject({
      turnId: 'turn-1',
      sessionId: request.sessionId,
      items: [expect.objectContaining({ objectType: 'assertion', objectId: reconciled.assertion.id })],
    });
    expect(recordExecutionContextFeedback({
      turnId: 'turn-1', rating: 'helpful', reason: 'Changed the response structure.',
    })).toBe(true);
    expect(recordExecutionContextFeedback({ turnId: 'missing', rating: 'irrelevant' })).toBe(false);
  });
});

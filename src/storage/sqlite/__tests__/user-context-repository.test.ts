import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';
import {
  createCollaborationRule,
  createContextEvidence,
  createUnderstanding,
  getTurnPersonalization,
  getUserProfile,
  isUnderstandingSuppressed,
  linkUnderstandingEvidence,
  listCollaborationRules,
  listUnderstandings,
  listUnderstandingEvidence,
  recordContextRun,
  rejectUnderstanding,
  reviseCollaborationRule,
  reviseUnderstanding,
  updateUserProfile,
} from '../user-context-repository.js';
import { summarizeUserUnderstandingQuality } from '../user-context-quality-repository.js';

describe('structured user context repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-context-domain-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores the user profile without a Markdown projection', () => {
    expect(getUserProfile().callName).toBe('');
    const saved = updateUserProfile({ callName: 'Mic', timezone: 'Asia/Shanghai' });
    expect(saved).toMatchObject({ callName: 'Mic', timezone: 'Asia/Shanghai' });
    expect(getUserProfile()).toEqual(saved);
  });

  it('keeps understanding revisions and suppresses rejected canonical claims', () => {
    const created = createUnderstanding({
      kind: 'preference',
      canonicalKey: 'preference:response-detail',
      status: 'active',
      scope: { type: 'global' },
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      confidence: 1,
      statement: 'Lead with the conclusion.',
      createdBy: 'user',
      changeReason: 'explicit instruction',
    });

    const revised = reviseUnderstanding(created.id, 'Lead with the conclusion, then explain tradeoffs.', {
      changeReason: 'user correction',
    });
    expect(revised.versionId).not.toBe(created.versionId);
    expect(revised.statement).toContain('tradeoffs');
    expect(listUnderstandings(['active'])).toHaveLength(1);

    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: 'turn:1',
      redactedExcerpt: 'I prefer concise answers.',
      trustLevel: 'owner',
      observedAt: Date.now(),
    });
    linkUnderstandingEvidence(revised.versionId, evidence.id, 'supports', 1);
    expect(listUnderstandingEvidence(created.id)).toEqual([evidence]);

    expect(isUnderstandingSuppressed(created.canonicalKey, created.scope)).toBe(false);
    expect(rejectUnderstanding(created.id, 'Never infer this again').status).toBe('rejected');
    expect(isUnderstandingSuppressed(created.canonicalKey, created.scope)).toBe(true);
  });

  it('stores only user-authored collaboration rules and revisions', () => {
    const rule = createCollaborationRule({
      category: 'boundary',
      priority: 10,
      scope: { type: 'global' },
      conditions: { action: 'external_write' },
      statement: 'Ask before sending anything externally.',
    });
    const revised = reviseCollaborationRule(rule.id, 'Always ask before sending anything externally.');
    expect(revised.revisionId).not.toBe(rule.revisionId);
    expect(listCollaborationRules()).toEqual([revised]);
  });

  it('records normalized turn personalization decisions', () => {
    const runId = recordContextRun({
      turnId: 'turn-1',
      sessionKey: 'agent:main:webchat:dm:1',
      query: 'Draft an update',
      budget: 4_000,
      durationMs: 12,
      items: [{
        objectType: 'understanding',
        objectId: 'understanding-1',
        versionId: 'version-1',
        decision: 'selected',
        reason: 'Relevant communication preference',
        content: 'Lead with the conclusion.',
        sourceLabel: 'You told xopc',
        rank: 1,
        score: 0.9,
        injectedChars: 42,
      }],
    });
    expect(getTurnPersonalization('turn-1')).toEqual({
      runId,
      items: [expect.objectContaining({ objectId: 'understanding-1', decision: 'selected' })],
    });

    const repeatedRunId = recordContextRun({
      turnId: 'turn-1', sessionKey: 'agent:main:webchat:dm:1', query: 'Draft a shorter update',
      budget: 2_000, durationMs: 4,
      items: [{
        objectType: 'profile', objectId: 'profile', decision: 'selected', reason: 'Updated plan',
        content: 'Preferred name: Mic', sourceLabel: 'You provided this directly', injectedChars: 19,
      }],
    });
    expect(repeatedRunId).toBe(runId);
    expect(getTurnPersonalization('turn-1')?.items).toEqual([
      expect.objectContaining({ objectType: 'profile', objectId: 'profile' }),
    ]);
  });

  it('computes quality metrics from structured understanding and turn feedback', () => {
    createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:quality', status: 'active',
      scope: { type: 'global' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 0.8,
      statement: 'Prefer concise summaries.', createdBy: 'user', changeReason: 'test',
    });
    const metrics = summarizeUserUnderstandingQuality();
    expect(metrics.records).toMatchObject({ total: 1, active: 1, explicit: 1, averageConfidence: 0.8 });
    expect(metrics.decisions).toMatchObject({ total: 1, acceptanceRate: 1 });
  });
});

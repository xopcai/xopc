import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createUnderstanding,
  openXopcDatabase,
  recordContextFeedback,
  recordContextRun,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { UserUnderstandingRetriever } from '../retriever.js';

describe('UserUnderstandingRetriever', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-retriever-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('combines FTS, identifiers, kinds, and scope deterministically', () => {
    const relevant = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:xopc', status: 'active',
      scope: { type: 'workspace', id: '/repo/xopc' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'The xopc repository releases through release-42.', createdBy: 'user', changeReason: 'test',
    });
    createUnderstanding({
      kind: 'relationship', canonicalKey: 'relationship:alex', status: 'active', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'Alex is a collaborator.',
      createdBy: 'runtime', changeReason: 'test',
    });
    const results = new UserUnderstandingRetriever().retrieve({
      query: 'How did the repository release-42 deploy?', sessionKey: 'session-1',
      workspaceId: '/repo/xopc', maxCandidates: 10,
    });
    expect(results[0]?.understanding.id).toBe(relevant.id);
    expect(results[0]?.reasons).toEqual(expect.arrayContaining(['fts', 'identifier', 'kind', 'explicit']));
  });

  it('uses Chinese bigrams when the wording is not an exact FTS match', () => {
    const relevant = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:direct', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: '低风险修改可以直接处理，不必反复询问。', createdBy: 'user', changeReason: 'test',
    });
    const result = new UserUnderstandingRetriever().retrieve({
      query: '低风险操作直接执行就行', sessionKey: 'session-1', workspaceId: '/repo', maxCandidates: 10,
    }).find((item) => item.understanding.id === relevant.id);
    expect(result?.reasons).toContain('lexical');
    expect(result?.score).toBeGreaterThan(0.35);
  });

  it('prioritizes matching scopes before applying the candidate limit', () => {
    createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:other', status: 'active',
      scope: { type: 'workspace', id: '/repo/other' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'Alpha deployment uses the other checklist.', createdBy: 'user', changeReason: 'test',
    });
    const matching = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:current', status: 'active',
      scope: { type: 'workspace', id: '/repo/current' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'Alpha deployment uses the current checklist.', createdBy: 'user', changeReason: 'test',
    });

    const results = new UserUnderstandingRetriever().retrieve({
      query: 'alpha deployment checklist', sessionKey: 'session-1', workspaceId: '/repo/current', maxCandidates: 1,
    });
    expect(results.map((item) => item.understanding.id)).toEqual([matching.id]);
  });

  it('uses repeated feedback as a bounded ranking signal', () => {
    const helpful = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:alpha-helpful', status: 'active',
      scope: { type: 'global' }, explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'Alpha release uses the deployment checklist.',
      createdBy: 'runtime', changeReason: 'test',
    });
    const irrelevant = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:alpha-irrelevant', status: 'active',
      scope: { type: 'global' }, explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'Alpha release uses the deployment checklist.',
      createdBy: 'runtime', changeReason: 'test',
    });
    for (let index = 0; index < 3; index += 1) {
      for (const [item, rating] of [[helpful, 'helpful'], [irrelevant, 'irrelevant']] as const) {
        const turnId = `turn-${item.id}-${index}`;
        const runId = recordContextRun({
          turnId, sessionKey: 'session-1', query: 'alpha deployment checklist', budget: 1_000, durationMs: 1,
          items: [{
            objectType: 'understanding', objectId: item.id, versionId: item.versionId,
            decision: 'selected', reason: 'test', content: item.statement, sourceLabel: 'test', injectedChars: 10,
          }],
        });
        recordContextFeedback({ turnId, runId, objectType: 'understanding', objectId: item.id, rating });
      }
    }

    const results = new UserUnderstandingRetriever().retrieve({
      query: 'alpha deployment checklist', sessionKey: 'session-1', workspaceId: '/repo', maxCandidates: 10,
    });
    const helpfulResult = results.find((item) => item.understanding.id === helpful.id);
    const irrelevantResult = results.find((item) => item.understanding.id === irrelevant.id);
    expect(helpfulResult?.reasons).toContain('feedback');
    expect(helpfulResult!.score).toBeGreaterThan(irrelevantResult!.score);
  });
});

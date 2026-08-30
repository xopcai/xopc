import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createContextEvidence,
  createUnderstanding,
  getUnderstanding,
  listKnowledgeSourceItems,
  listMemoryRecords,
  linkUnderstandingEvidence,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
  upsertMemoryRecord,
} from '../../../../storage/sqlite/index.js';
import {
  createUnderstandingSourceRun,
  listUserFocuses,
  upsertUnderstandingSourceGrant,
  upsertUserFocus,
} from '../../../../user-context/sources/repository.js';
import { applySourceRevocationChoices, sourceRevocationImpact } from '../understanding-sources.js';

describe('understanding source revocation impact', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-source-impact-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('counts only non-explicit objects whose sole evidence is the revoked source', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'connector:impact', adapterId: 'connector:test', category: 'files', platform: 'all',
      displayName: 'Impact source', accessMode: 'once', retentionPolicy: 'derived_only',
      processingPolicy: 'remote_allowed', config: { connectorId: 'test', accountId: 'account' },
    });
    const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap' });
    const sourceOnly = createUnderstanding({
      kind: 'project_context', canonicalKey: 'impact:only', status: 'candidate', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'Source-only context.',
      createdBy: 'connector', changeReason: 'test',
    });
    const independent = createUnderstanding({
      kind: 'project_context', canonicalKey: 'impact:independent', status: 'candidate', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'Independently supported context.',
      createdBy: 'connector', changeReason: 'test',
    });
    const connectedEvidence = createContextEvidence({
      sourceType: 'runtime', sourceRef: `understanding-source-grant:${grant.id}:item`,
      trustLevel: 'untrusted', observedAt: 1,
    });
    const userEvidence = createContextEvidence({
      sourceType: 'conversation', sourceRef: 'session:test:turn:1', trustLevel: 'owner', observedAt: 2,
    });
    linkUnderstandingEvidence(sourceOnly.versionId, connectedEvidence.id, 'supports', 0.8);
    linkUnderstandingEvidence(independent.versionId, connectedEvidence.id, 'supports', 0.8);
    linkUnderstandingEvidence(independent.versionId, userEvidence.id, 'supports', 1);
    upsertUserFocus({
      canonicalKey: 'impact:focus', title: 'Source focus', summary: 'Source-only focus',
      horizon: 'current', status: 'candidate', confidence: 0.8,
      evidenceRefs: [connectedEvidence.sourceRef], sourceRunId: run.id,
    });
    const sourceInstanceId = 'composio:test:account';
    upsertKnowledgeSourceItems([{
      sourceInstanceId,
      collectionScope: 'items',
      externalId: 'raw-1',
      itemType: 'test:item',
      contentHash: 'hash-1',
      normalizedText: 'Bounded source material.',
      synthesisPipeline: 'connected_knowledge',
    }]);
    upsertMemoryRecord({
      providerId: 'connected-knowledge',
      kind: 'workspace_fact',
      sourceAgentId: 'main',
      content: 'Derived connected memory.',
      source: { provider: 'test', sourceInstanceId },
    });

    const impact = sourceRevocationImpact(grant.id)!;
    expect(impact).toMatchObject({
      derivedCount: 3,
      understandingCount: 1,
      focusCount: 1,
      memoryRecordCount: 1,
      boundedRawCount: 1,
      understandingIds: [sourceOnly.id],
    });

    expect(applySourceRevocationChoices(impact, { derived: 'delete', raw: 'delete' }))
      .toEqual({ derivedDeleted: 3, rawDeleted: 1 });
    expect(getUnderstanding(sourceOnly.id)).toBeUndefined();
    expect(listUserFocuses()).toEqual([]);
    expect(listMemoryRecords({ providerId: 'connected-knowledge' })).toEqual([]);
    expect(listKnowledgeSourceItems({ sourceInstanceId })).toEqual([]);
  });
});

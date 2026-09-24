import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import {
  getUserAssertion, listUserModelObservations, reconcileAssertion, recordUserModelObservation,
} from '../../../user-model/index.js';
import {
  createUnderstandingSourceRun,
  getOrCreateConnectorUnderstandingSourceRun,
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  revokeUnderstandingSourceGrant,
  upsertUnderstandingSourceGrant,
  updateUnderstandingSourceGrantPolicies,
  updateUnderstandingSourceRun,
} from '../repository.js';
import { getActiveUnderstandingConsent, grantUnderstandingConsent } from '../consent-repository.js';

describe('understanding source repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-sources-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('owns grants, collection runs, and checkpoints in the unified model', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'local:linux-recent-documents',
      adapterId: 'linux-recent-documents',
      category: 'recent_documents',
      platform: 'linux',
      displayName: 'Recent documents',
      accessMode: 'once',
      retentionPolicy: 'metadata_only',
      processingPolicy: 'local_only',
      config: { readOnly: true },
      checkpoint: { cursor: 'a' },
      nowMs: 10,
    });
    const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap', nowMs: 11 });
    updateUnderstandingSourceRun(run.id, { status: 'completed', itemsSeen: 8, cursorAfter: 'b', completed: true, nowMs: 12 });

    expect(listUnderstandingSourceGrants()).toEqual([expect.objectContaining({ id: grant.id, checkpoint: { cursor: 'a' } })]);
    expect(listUnderstandingSourceRuns(grant.id)).toEqual([
      expect.objectContaining({ id: run.id, status: 'completed', itemsSeen: 8, cursorAfter: 'b', completedAt: 12 }),
    ]);
    expect(upsertUnderstandingSourceGrant({
      sourceKey: grant.sourceKey, adapterId: grant.adapterId, category: grant.category, platform: grant.platform,
      displayName: grant.displayName, accessMode: 'continuous', retentionPolicy: 'bounded_raw',
      processingPolicy: 'remote_allowed', config: {}, nowMs: 12,
    })).toMatchObject({
      accessMode: 'once', retentionPolicy: 'metadata_only', processingPolicy: 'local_only',
    });
    expect(revokeUnderstandingSourceGrant(grant.id, 13)).toMatchObject({ status: 'revoked' });
    expect(listUnderstandingSourceGrants()).toEqual([]);
  });

  it('updates source privacy policies only through the explicit policy operation', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'local:policy', adapterId: 'local-work-folders', category: 'files', platform: 'all',
      displayName: 'Local policy', accessMode: 'continuous', retentionPolicy: 'metadata_only',
      processingPolicy: 'local_only', config: { sourceInstanceId: 'connector:consent' }, nowMs: 10,
    });
    expect(updateUnderstandingSourceGrantPolicies(grant.id, {
      retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', nowMs: 11,
    })).toMatchObject({ retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', updatedAt: 11 });
  });

  it('creates one source run per connector learning job', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'connector-account:one', adapterId: 'connector:gmail', category: 'mail', platform: 'all',
      displayName: 'Mail', accessMode: 'continuous', retentionPolicy: 'bounded_raw',
      processingPolicy: 'remote_allowed', config: {}, nowMs: 10,
    });
    const first = getOrCreateConnectorUnderstandingSourceRun({
      grantId: grant.id, connectorLearningJobId: 'job-1', kind: 'bootstrap', nowMs: 11,
    });
    const repeated = getOrCreateConnectorUnderstandingSourceRun({
      grantId: grant.id, connectorLearningJobId: 'job-1', kind: 'incremental', nowMs: 12,
    });

    expect(repeated.id).toBe(first.id);
    expect(listUnderstandingSourceRuns(grant.id)).toEqual([
      expect.objectContaining({ id: first.id, connectorLearningJobId: 'job-1', kind: 'bootstrap' }),
    ]);
  });

  it('records one active consent receipt and revokes it with the source', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'connector-account:consent', adapterId: 'connector:gmail', category: 'mail', platform: 'all',
      displayName: 'Mail', accessMode: 'continuous', retentionPolicy: 'derived_only',
      processingPolicy: 'local_only', config: { sourceInstanceId: 'connector:consent' }, nowMs: 10,
    });
    const first = grantUnderstandingConsent({
      grantId: grant.id, purposes: ['personalization'], allowedDomains: ['preferences'],
      deniedDomains: ['health'], allowedFields: ['title'], accessMode: 'continuous',
      lookbackDays: 30, rawRetentionDays: 0, processingPolicy: 'local_only',
      allowedAgentIds: ['main'], disclosureVersion: 'v1', nowMs: 11,
    });
    const replacement = grantUnderstandingConsent({
      grantId: grant.id, purposes: ['personalization'], allowedDomains: ['preferences', 'behavior'],
      deniedDomains: ['health'], allowedFields: ['title', 'timestamps'], accessMode: 'continuous',
      lookbackDays: 60, rawRetentionDays: 0, processingPolicy: 'local_only',
      allowedAgentIds: ['main'], disclosureVersion: 'v2', nowMs: 12,
    });
    expect(first.id).not.toBe(replacement.id);
    expect(getActiveUnderstandingConsent(grant.id)).toMatchObject({ id: replacement.id, disclosureVersion: 'v2' });
    recordUserModelObservation({
      domain: 'behavior', type: 'message_activity', subject: { type: 'user', id: 'self' },
      value: { count: 1 }, context: {}, sensitivityCategories: [], ownerAttribution: 'user',
      observedAt: 12, sourceGrantId: grant.id,
    });
    getSqliteDatabase().prepare(`INSERT INTO context_evidence (
      evidence_id, principal_id, source_type, source_instance_id, source_ref,
      redacted_excerpt, trust_level, observed_at, created_at
    ) VALUES ('consent-evidence', 'local-owner', 'connector', 'connector:consent',
      'connector://one', 'private preview', 'owner', 12, 12)`).run();
    const assertion = reconcileAssertion({
      subject: { type: 'user', id: 'self' }, predicate: 'preference.connected.test',
      cardinality: 'single', scope: { type: 'global' }, kind: 'preference',
      value: 'brief', normalizedValue: 'brief', statement: 'Prefers brief updates.',
      authority: 'user_observed', confidence: 0.9, inferredImportance: 0.7,
      consequence: 'low', actionability: 0.8, volatility: 'slow', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', domain: 'preferences', layer: 'pattern',
      purposeIds: ['personalization'], allowedUses: ['answer', 'recommend'], allowedAgentIds: ['main'],
      consentReceiptId: replacement.id, observedAt: 12, createdBy: 'connector', evidenceId: 'consent-evidence',
    }, 12).assertion;
    revokeUnderstandingSourceGrant(grant.id, 13);
    expect(getActiveUnderstandingConsent(grant.id)).toBeNull();
    expect(listUserModelObservations({ sourceGrantId: grant.id })).toEqual([]);
    expect(getUserAssertion(assertion.id)).toMatchObject({ status: 'needs_review', supportCount: 0 });
    expect(getSqliteDatabase().prepare('SELECT redacted_excerpt FROM context_evidence WHERE evidence_id = ?')
      .get('consent-evidence')).toEqual({ redacted_excerpt: null });
  });

});

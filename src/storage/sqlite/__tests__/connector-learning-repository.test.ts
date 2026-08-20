import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  claimNextConnectorLearningJob,
  closeXopcDatabase,
  enqueueConnectorLearningJob,
  listConnectorLearningJobs,
  openXopcDatabase,
  recoverStaleConnectorLearningJobs,
  resetXopcDatabaseSingletonForTest,
  setConnectorLearningPaused,
  updateConnectorLearningJob,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../index.js';

describe('connector learning repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-connector-learning-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    upsertConnectorInstallation({
      id: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      principalId: 'local-owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'read',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    upsertConnectorConnection({
      id: 'gmail-work',
      installationId: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'provider-work',
      identity: {},
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'gmail' },
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('enqueues idempotently and advances a durable job', () => {
    const input = {
      connectorId: 'composio-gmail',
      accountId: 'account:gmail-work',
      connectionId: 'gmail-work',
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      agentId: 'main',
      mode: 'bootstrap' as const,
      idempotencyKey: 'bootstrap:gmail-work:v1',
      nowMs: 1_000,
    };
    const first = enqueueConnectorLearningJob(input);
    expect(enqueueConnectorLearningJob(input).id).toBe(first.id);
    expect(claimNextConnectorLearningJob(1_000)).toMatchObject({
      id: first.id,
      status: 'running',
      phase: 'fetching',
      attemptCount: 1,
    });
    expect(updateConnectorLearningJob(first.id, {
      status: 'completed',
      phase: 'completed',
      itemsDiscovered: 12,
      itemsIndexed: 10,
      candidatesCreated: 2,
      finished: true,
      nowMs: 2_000,
    })).toMatchObject({ status: 'completed', itemsIndexed: 10, candidatesCreated: 2 });
  });

  it('recovers interrupted work and supports pause and resume', () => {
    const job = enqueueConnectorLearningJob({
      connectorId: 'composio-gmail',
      accountId: 'account:gmail-work',
      connectionId: 'gmail-work',
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      agentId: 'main',
      mode: 'incremental',
      idempotencyKey: 'incremental:gmail-work:event:1',
      nowMs: 1_000,
    });
    claimNextConnectorLearningJob(1_000);
    expect(recoverStaleConnectorLearningJobs(1_001, 2_000)).toBe(1);
    expect(listConnectorLearningJobs()[0]).toMatchObject({ status: 'failed' });
    expect(setConnectorLearningPaused('account:gmail-work', true, 3_000)).toBe(1);
    expect(listConnectorLearningJobs()[0]).toMatchObject({ status: 'paused' });
    expect(setConnectorLearningPaused('account:gmail-work', false, 4_000)).toBe(1);
    expect(claimNextConnectorLearningJob(4_000)?.id).toBe(job.id);
  });
});

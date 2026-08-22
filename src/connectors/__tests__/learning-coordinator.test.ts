import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  listConnectorLearningJobs,
  getConnectorConnection,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorSyncPolicy,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import type { MemoryManager } from '../../agent/memory/manager.js';

const { ingestComposioConnectedSource } = vi.hoisted(() => ({
  ingestComposioConnectedSource: vi.fn(async () => ({
    connectorId: 'composio-gmail',
    actionId: 'GMAIL_FETCH_EMAILS',
    sourceInstanceId: 'composio:composio-gmail:gmail-work',
    itemsSeen: 8,
    itemsIndexed: 6,
    recordIds: [],
  })),
}));

vi.mock('../connected-source-ingestion.js', () => ({ ingestComposioConnectedSource }));

import { startConnectorLearningCoordinator } from '../learning-coordinator.js';
import { buildConnectorLearningArguments, getConnectorLearningPlan } from '../learning-recipes.js';
import type { ComposioSessionsAdapter } from '../composio-sessions.js';

const identityAdapter = {
  executeWithPolicy: vi.fn(async () => ({
    decision: 'allowed' as const,
    result: { emailAddress: 'owner@example.com' },
  })),
} as unknown as ComposioSessionsAdapter;

describe('connector learning coordinator', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-learning-coordinator-'));
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
    vi.clearAllMocks();
  });

  it('automatically bootstraps an eligible connection and schedules the next incremental run', async () => {
    const config = ConfigSchema.parse({});
    const coordinator = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
      composioAdapter: identityAdapter,
    });
    try {
      const queued = listConnectorLearningJobs({ connectionId: 'gmail-work' })[0];
      expect(queued).toMatchObject({ mode: 'bootstrap', status: 'queued' });
      await coordinator.runNow();
      expect(ingestComposioConnectedSource).toHaveBeenCalledOnce();
      expect(getConnectorConnection('gmail-work')?.identity).toEqual({ email: 'owner@example.com' });
      const jobs = listConnectorLearningJobs({ connectionId: 'gmail-work' });
      expect(jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({ mode: 'bootstrap', status: 'completed', itemsIndexed: 6 }),
        expect.objectContaining({ mode: 'incremental', status: 'queued' }),
      ]));
    } finally {
      coordinator.stop();
    }
  });

  it('uses the stored cursor to bound supported incremental reads', () => {
    const plan = getConnectorLearningPlan('gmail')!;
    expect(buildConnectorLearningArguments(
      plan,
      plan.streams[0]!,
      { cursor: '2026-08-01T00:00:00.000Z' },
      { email: 'owner@example.com' },
    )).toMatchObject({
      query: `after:${Math.floor(Date.parse('2026-08-01T00:00:00.000Z') / 1_000)} -in:spam -in:trash`,
    });
  });

  it('honors per-connection scan enablement and interval', async () => {
    const config = ConfigSchema.parse({});
    expect(upsertConnectorSyncPolicy({
      accountId: 'account:gmail-work',
      proactiveEnabled: true,
      defaultIntervalMinutes: 15,
    }).intervalMinutes).toBe(15);
    upsertConnectorSyncPolicy({
      accountId: 'account:gmail-work',
      scanEnabled: true,
      intervalMinutes: 5,
    });
    const coordinator = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
      composioAdapter: identityAdapter,
    });
    try {
      const before = Date.now();
      await coordinator.runNow();
      const incremental = listConnectorLearningJobs({ connectionId: 'gmail-work' })
        .find((job) => job.mode === 'incremental');
      const nextRunAt = Date.parse(incremental?.nextRunAt ?? '');
      expect(nextRunAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
      expect(nextRunAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    } finally {
      coordinator.stop();
    }

    upsertConnectorSyncPolicy({ accountId: 'account:gmail-work', scanEnabled: false });
    const disabled = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
      composioAdapter: identityAdapter,
    });
    try {
      expect(disabled.enqueueConnection('gmail-work', { reason: 'schedule' })).toBeNull();
      expect(disabled.enqueueConnection('gmail-work', { reason: 'manual' })).not.toBeNull();
    } finally {
      disabled.stop();
    }
  });

  it('stores a safe failure code instead of the provider response body', async () => {
    ingestComposioConnectedSource.mockRejectedValueOnce(new Error(
      '400 {"error":{"message":"Could not find connected account(s)","slug":"ToolRouterV2_InvalidConnectedAccountIds"}}',
    ));
    const config = ConfigSchema.parse({});
    const coordinator = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
      composioAdapter: identityAdapter,
    });
    try {
      await coordinator.runNow();
      expect(listConnectorLearningJobs({ connectionId: 'gmail-work' })[0]).toMatchObject({
        status: 'failed',
        error: 'connected_account_unavailable',
      });
    } finally {
      coordinator.stop();
    }
  });
});

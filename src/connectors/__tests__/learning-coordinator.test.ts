import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  listConnectorLearningJobs,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
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
import { buildConnectorLearningArguments, getConnectorLearningRecipe } from '../learning-recipes.js';

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
    config.userContext.memory.sources = [...config.userContext.memory.sources, 'connectedSources'];
    const coordinator = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
    });
    try {
      const queued = listConnectorLearningJobs({ connectionId: 'gmail-work' })[0];
      expect(queued).toMatchObject({ mode: 'bootstrap', status: 'queued' });
      await coordinator.runNow();
      expect(ingestComposioConnectedSource).toHaveBeenCalledOnce();
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
    const recipe = getConnectorLearningRecipe('gmail')!;
    expect(buildConnectorLearningArguments(recipe, { cursor: '2026-08-01T00:00:00.000Z' })).toMatchObject({
      query: `after:${Math.floor(Date.parse('2026-08-01T00:00:00.000Z') / 1_000)} -in:spam -in:trash`,
    });
  });

  it('stores a safe failure code instead of the provider response body', async () => {
    ingestComposioConnectedSource.mockRejectedValueOnce(new Error(
      '400 {"error":{"message":"Could not find connected account(s)","slug":"ToolRouterV2_InvalidConnectedAccountIds"}}',
    ));
    const config = ConfigSchema.parse({});
    config.userContext.memory.sources = [...config.userContext.memory.sources, 'connectedSources'];
    const coordinator = startConnectorLearningCoordinator({
      getConfig: () => config,
      resolveAgentId: () => 'main',
      getMemoryManager: () => ({ applyUnderstandingCandidates: vi.fn() }) as unknown as MemoryManager,
      initialDelayMs: 60_000,
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

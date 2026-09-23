import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import { HomeCapabilityPreflightService } from '../capability-preflight.js';

const config = {
  connectors: {
    instances: {
      'composio-gmail': {
        xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true },
        runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
        scope: 'read',
      },
    },
  },
} as unknown as Config;

describe('HomeCapabilityPreflightService', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    upsertConnectorInstallation({
      id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner',
      enabled: true, allowedAgentIds: ['main'], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  function service(skills: Array<{ name: string; availableForCurrentAgent: boolean; unavailableReason: null | 'disabled' }> = []) {
    return new HomeCapabilityPreflightService({
      config: () => config,
      agentId: () => 'main',
      skills: () => skills,
      principalId: 'local-owner',
    });
  }

  it('returns a specific recovery path until a permitted connector account is active', () => {
    const preflight = service();
    expect(preflight.resolve([{ kind: 'connector', capability: 'composio-gmail', required: true }]).preflight)
      .toMatchObject({
        state: 'needs_setup',
        blockers: [{
          code: 'connection_missing',
          recoveryPath: '/connectors?connector=composio-gmail&returnTo=%2F',
        }],
      });

    upsertConnectorConnection({
      id: 'gmail-work', installationId: 'composio-gmail-local-owner', connectorId: 'composio-gmail',
      provider: 'composio', principalId: 'local-owner', providerConnectionId: 'work', identity: {},
      status: 'active', isDefault: true, metadata: {},
    });
    expect(preflight.resolve([{ kind: 'connector', capability: 'composio-gmail', required: true }]))
      .toMatchObject({ preflight: { state: 'ready' }, capabilities: [{ readiness: 'ready' }] });
    expect(preflight.inventory().connectors).toEqual(new Set(['composio-gmail']));
  });

  it('returns skill setup and an explicit degraded action only when one is available', () => {
    const result = service([{ name: 'weekly-review', availableForCurrentAgent: false, unavailableReason: 'disabled' }])
      .resolve([{ kind: 'skill', capability: 'weekly-review', required: true }], { degradedActionAvailable: true });
    expect(result).toMatchObject({
      capabilities: [{ readiness: 'needs_setup', reason: 'weekly-review is unavailable: disabled.' }],
      preflight: {
        state: 'needs_setup',
        blockers: [{ code: 'disabled' }],
        degradedAction: { mode: 'degraded_start' },
      },
    });
  });
});

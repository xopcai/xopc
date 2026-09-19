import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';
import type { WorkflowDefinition } from '../../workflows/domain/definition.js';
import { preflightWorkflowConnectors } from '../workflow-preflight.js';

describe('workflow connector preflight', () => {
  let stateDir: string;
  const definition = {
    connectors: [{ connectorId: 'composio-gmail', scope: 'read' }],
  } as WorkflowDefinition;
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

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-workflow-connectors-'));
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
      selectedAccountIds: null,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('blocks before a required account is connected and passes when healthy', () => {
    expect(preflightWorkflowConnectors({ definition, config, agentId: 'main' })).toMatchObject({
      ok: false,
      issues: [{ code: 'connection_missing' }],
    });
    upsertConnectorConnection({
      id: 'gmail-work',
      installationId: 'composio-gmail-local-owner',
      connectorId: 'composio-gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'ca_work',
      identity: { email: 'work@example.com' },
      status: 'active',
      isDefault: true,
      metadata: { toolkit: 'gmail' },
    });
    expect(preflightWorkflowConnectors({ definition, config, agentId: 'main' })).toMatchObject({ ok: true, issues: [] });
  });

  it('enforces per-agent policy before starting the workflow', () => {
    expect(preflightWorkflowConnectors({ definition, config, agentId: 'other' })).toMatchObject({
      ok: false,
      issues: [{ code: 'agent_not_allowed' }],
    });
  });

  it('requires explicit stable accounts for unattended multi-account execution', () => {
    const records = ['work', 'personal'].map(id => upsertConnectorConnection({
      id, installationId: 'composio-gmail-local-owner', connectorId: 'composio-gmail', provider: 'composio',
      principalId: 'local-owner', providerConnectionId: id, identity: {}, status: 'active', isDefault: false, metadata: {},
    }));
    expect(preflightWorkflowConnectors({ definition, config, agentId: 'main' })).toMatchObject({
      ok: false, issues: [{ code: 'account_selection_required' }],
    });
    const selected = { ...definition, connectors: [{ connectorId: 'composio-gmail', accountIds: [records[0].accountId!] }] };
    expect(preflightWorkflowConnectors({ definition: selected, config, agentId: 'main' })).toMatchObject({
      ok: true, accounts: { 'composio-gmail': [records[0].accountId] },
    });
    upsertConnectorConnection({ ...records[0], status: 'revoked' });
    expect(preflightWorkflowConnectors({ definition: selected, config, agentId: 'main' })).toMatchObject({
      ok: false, accounts: {}, issues: [{ code: 'connection_missing' }],
    });
  });
});

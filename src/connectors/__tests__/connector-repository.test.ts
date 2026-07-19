import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendConnectorExecutionAudit,
  claimConnectorWebhookDelivery,
  closeXopcDatabase,
  completeConnectorWebhookDelivery,
  consumeConnectorApproval,
  createConnectorApproval,
  decideConnectorApproval,
  getConnectorConnection,
  listConnectorActionMetadata,
  listConnectorConnections,
  listConnectorExecutionAudit,
  listConnectorInstallations,
  openXopcDatabase,
  readSchemaVersion,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorActionMetadata,
  upsertConnectorConnection,
  upsertConnectorInstallation,
} from '../../storage/sqlite/index.js';

describe('connector repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-connectors-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('migrates to the connector schema and persists policy separately from accounts', () => {
    expect(readSchemaVersion(requireXopcDatabase().db)).toBe(32);
    const installation = upsertConnectorInstallation({
      id: 'install-gmail-owner',
      connectorId: 'composio-gmail',
      principalId: 'owner',
      enabled: true,
      allowedAgentIds: ['main'],
      maxScope: 'write',
      confirmationPolicy: 'writes',
      selectedConnectionIds: [],
    });
    expect(installation).toMatchObject({ connectorId: 'composio-gmail', maxScope: 'write' });
    expect(listConnectorInstallations('owner')).toHaveLength(1);

    upsertConnectorConnection({
      id: 'connection-personal',
      installationId: installation.id,
      connectorId: installation.connectorId,
      provider: 'composio',
      principalId: 'owner',
      providerConnectionId: 'ca_personal',
      alias: 'Personal',
      identity: { email: 'owner@example.com' },
      status: 'active',
      isDefault: true,
      metadata: {},
    });
    upsertConnectorConnection({
      id: 'connection-work',
      installationId: installation.id,
      connectorId: installation.connectorId,
      provider: 'composio',
      principalId: 'owner',
      providerConnectionId: 'ca_work',
      alias: 'Work',
      identity: { email: 'owner@work.example' },
      status: 'active',
      isDefault: true,
      metadata: {},
    });

    const connections = listConnectorConnections({ principalId: 'owner', connectorId: installation.connectorId });
    expect(connections).toHaveLength(2);
    expect(connections.filter((connection) => connection.isDefault).map((connection) => connection.id)).toEqual(['connection-work']);
    expect(getConnectorConnection('connection-personal')?.isDefault).toBe(false);
  });

  it('caches action contracts and records bounded execution audit data', () => {
    upsertConnectorActionMetadata({
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_SEND_EMAIL',
      toolkit: 'gmail',
      scope: 'write',
      curated: true,
      inputSchema: { type: 'object', required: ['to'] },
      schemaVersion: '2026-07-01',
      cachedAt: '2026-07-19T00:00:00.000Z',
    });
    expect(listConnectorActionMetadata('composio-gmail')[0]).toMatchObject({
      actionId: 'GMAIL_SEND_EMAIL',
      inputSchema: { type: 'object', required: ['to'] },
    });

    appendConnectorExecutionAudit({
      connectorId: 'composio-gmail',
      principalId: 'owner',
      agentId: 'main',
      sessionKey: 'agent:main:chat:1',
      actionId: 'GMAIL_SEND_EMAIL',
      scope: 'write',
      decision: 'confirmation_required',
      resultStatus: 'not_executed',
    });
    expect(listConnectorExecutionAudit({ principalId: 'owner' })[0]).toMatchObject({
      actionId: 'GMAIL_SEND_EMAIL',
      decision: 'confirmation_required',
    });
  });

  it('binds one-time approvals to the exact argument hash', () => {
    const approval = createConnectorApproval({
      principalId: 'owner',
      connectorId: 'composio-gmail',
      actionId: 'GMAIL_SEND_EMAIL',
      scope: 'write',
      argumentsHash: 'hash-1',
      argumentsPreview: { to: 'owner@example.com' },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(decideConnectorApproval(approval.id, 'approved')?.status).toBe('approved');
    expect(consumeConnectorApproval(approval.id, 'different-hash')).toBeUndefined();
    expect(consumeConnectorApproval(approval.id, 'hash-1')?.status).toBe('consumed');
    expect(consumeConnectorApproval(approval.id, 'hash-1')).toBeUndefined();
  });

  it('claims webhook deliveries once and acknowledges processed retries', () => {
    expect(claimConnectorWebhookDelivery({ id: 'webhook-1', provider: 'composio', payloadHash: 'hash' })).toBe('claimed');
    expect(claimConnectorWebhookDelivery({ id: 'webhook-1', provider: 'composio', payloadHash: 'hash' })).toBe('in_flight');
    completeConnectorWebhookDelivery('webhook-1');
    expect(claimConnectorWebhookDelivery({ id: 'webhook-1', provider: 'composio', payloadHash: 'hash' })).toBe('processed');
    expect(() => claimConnectorWebhookDelivery({ id: 'webhook-1', provider: 'composio', payloadHash: 'other' }))
      .toThrow(/different payload/);
  });
});

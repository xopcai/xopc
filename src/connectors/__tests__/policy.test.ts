import { describe, expect, it } from 'vitest';

import { evaluateConnectorExecutionPolicy } from '../policy.js';
import type { ConnectorInstallationPolicy } from '../types.js';

const installation: ConnectorInstallationPolicy = {
  id: 'install-1',
  connectorId: 'composio-gmail',
  principalId: 'owner',
  enabled: true,
  allowedAgentIds: ['main'],
  maxScope: 'write',
  confirmationPolicy: 'writes',
  selectedConnectionIds: ['connection-1'],
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};

describe('evaluateConnectorExecutionPolicy', () => {
  it('requires confirmation for a curated write action', () => {
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'write', curated: true },
      agentId: 'main',
      connectionId: 'connection-1',
    }).decision).toBe('confirmation_required');
  });

  it('allows the write action only after confirmation', () => {
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'write', curated: true },
      agentId: 'main',
      connectionId: 'connection-1',
      confirmed: true,
    }).decision).toBe('allowed');
  });

  it('denies wrong agents, accounts, excessive scopes, and unverified actions', () => {
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'read', curated: true },
      agentId: 'other',
      connectionId: 'connection-1',
    }).decision).toBe('denied');
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'read', curated: true },
      agentId: 'main',
      connectionId: 'connection-2',
    }).decision).toBe('denied');
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'admin', curated: true },
      agentId: 'main',
      connectionId: 'connection-1',
    }).decision).toBe('denied');
    expect(evaluateConnectorExecutionPolicy({
      installation,
      action: { scope: 'read', curated: false },
      agentId: 'main',
      connectionId: 'connection-1',
    }).decision).toBe('denied');
  });
});

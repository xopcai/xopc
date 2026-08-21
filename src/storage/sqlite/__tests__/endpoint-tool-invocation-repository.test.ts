import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  finishEndpointToolInvocationAudit,
  listEndpointToolInvocationAudits,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startEndpointToolInvocationAudit,
} from '../index.js';

describe('endpoint tool invocation audit repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-endpoint-audit-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records only argument hashes and terminal status', () => {
    startEndpointToolInvocationAudit({
      id: 'invocation-1', principalId: 'principal-1', endpointId: 'endpoint-1',
      toolCallId: 'tool-call-1', toolName: 'web.page.read', effect: 'read',
      confirmationRequired: false, argumentsSha256: 'a'.repeat(64), startedAt: 100,
    });
    finishEndpointToolInvocationAudit({ id: 'invocation-1', status: 'succeeded', completedAt: 120 });
    expect(listEndpointToolInvocationAudits()).toEqual([expect.objectContaining({
      id: 'invocation-1', status: 'succeeded', argumentsSha256: 'a'.repeat(64), completedAt: 120,
    })]);
  });
});

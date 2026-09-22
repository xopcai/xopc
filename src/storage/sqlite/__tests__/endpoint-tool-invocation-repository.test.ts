import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  finishEndpointToolInvocationAudit,
  listEndpointToolInvocationAuditPage,
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
    expect(listEndpointToolInvocationAuditPage().items).toEqual([expect.objectContaining({
      id: 'invocation-1', status: 'succeeded', argumentsSha256: 'a'.repeat(64), completedAt: 120,
    })]);
  });

  it('filters and paginates invocation audits', () => {
    for (const [index, effect] of (['read', 'write', 'read'] as const).entries()) {
      startEndpointToolInvocationAudit({
        id: `invocation-${index}`, principalId: index === 1 ? 'phone' : 'browser', endpointId: `endpoint-${index}`,
        toolCallId: `call-${index}`, toolName: index === 1 ? 'mobile.notify' : 'web.page.read', effect,
        confirmationRequired: false, argumentsSha256: String(index).repeat(64), startedAt: 100 + index,
      });
      finishEndpointToolInvocationAudit({ id: `invocation-${index}`, status: index === 2 ? 'failed' : 'succeeded' });
    }

    expect(listEndpointToolInvocationAuditPage({ pageSize: 1 }).total).toBe(3);
    expect(listEndpointToolInvocationAuditPage({ page: 2, pageSize: 1 }).items[0]?.id).toBe('invocation-1');
    expect(listEndpointToolInvocationAuditPage({ principalId: 'phone' }).items.map((item) => item.id)).toEqual(['invocation-1']);
    expect(listEndpointToolInvocationAuditPage({ status: 'failed', query: 'web.page' }).items.map((item) => item.id)).toEqual(['invocation-2']);
    expect(listEndpointToolInvocationAuditPage({ effect: 'write' }).items.map((item) => item.id)).toEqual(['invocation-1']);
    expect(listEndpointToolInvocationAuditPage({ query: '%' }).items).toEqual([]);
  });
});

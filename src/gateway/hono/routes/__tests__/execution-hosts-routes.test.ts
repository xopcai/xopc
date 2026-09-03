import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ExecutionHostRuntime,
  createExecutionHostIdentity,
  createExecutionHostTicketRequest,
} from '../../../../execution-hosts/index.js';
import { RealtimeTicketStore } from '../../../../realtime/tickets.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import {
  registerExecutionHostRoutes,
  registerPublicExecutionHostRoutes,
} from '../execution-hosts.js';

describe('execution host routes', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-host-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('enrolls with a one-time code and issues signed host tickets', async () => {
    const executionHosts = new ExecutionHostRuntime();
    const tickets = new RealtimeTicketStore();
    const service = { executionHosts, realtime: { tickets } } as unknown as GatewayService;
    const publicApp = new Hono();
    const managementApp = new Hono();
    registerPublicExecutionHostRoutes(publicApp, service);
    registerExecutionHostRoutes(managementApp, { service } as AuthenticatedRouteDeps);

    const identity = createExecutionHostIdentity({
      stateDir: join(stateDir, 'identity'),
      displayName: 'Build host',
      appVersion: '1',
      capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
      maxConcurrency: 2,
    });
    const enrollment = executionHosts.enrollments.issue();
    const enroll = await publicApp.request('/api/execution-hosts/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, registration: identity.registration }),
    });
    expect(enroll.status).toBe(201);
    const enrollText = await enroll.text();
    expect(enrollText).not.toContain(identity.registration.publicKey);

    const repeated = await publicApp.request('/api/execution-hosts/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, registration: identity.registration }),
    });
    expect(repeated.status).toBe(401);

    const ticket = await publicApp.request('/api/execution-hosts/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createExecutionHostTicketRequest(identity)),
    });
    expect(ticket.status).toBe(200);
    await expect(ticket.json()).resolves.toMatchObject({
      payload: {
        clientId: identity.registration.hostId,
        clientKind: 'execution_host',
        principalId: `execution-host:${identity.registration.hostId}`,
        scopes: [],
      },
    });

    const list = await managementApp.request('/api/execution-hosts');
    const listText = await list.text();
    expect(JSON.parse(listText)).toMatchObject({
      payload: [{ id: identity.registration.hostId, online: false }],
    });
    expect(listText).not.toContain(identity.registration.publicKey);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerFocusRoutes } from '../focuses.js';

describe('focus routes', () => {
  let stateDir: string;
  let app: Hono;
  const emit = vi.fn();

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-focus-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    emit.mockReset();
    app = new Hono();
    const service = {
      emit,
      automationServiceInstance: {},
    } as unknown as GatewayService;
    registerFocusRoutes(app, {
      service,
      strictRateLimitMiddleware: async (_c, next) => next(),
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates, lists, pauses, and deletes a first-class focus', async () => {
    const createdResponse = await app.request('/api/focuses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Gateway billing', summary: 'Implement quota accounts.' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { focus: { id: string; status: string } };
    expect(created.focus.status).toBe('active');

    const listResponse = await app.request('/api/focuses');
    expect((await listResponse.json() as { focuses: unknown[] }).focuses).toHaveLength(1);

    const pausedResponse = await app.request(`/api/focuses/${created.focus.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(await pausedResponse.json()).toEqual(expect.objectContaining({
      focus: expect.objectContaining({ status: 'paused' }),
    }));

    expect((await app.request(`/api/focuses/${created.focus.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/focuses/${created.focus.id}`)).status).toBe(404);
    expect(emit).toHaveBeenCalledWith('focus.deleted', { focusId: created.focus.id });
  });

  it('rejects old trial semantics and invalid new monitor kinds', async () => {
    expect((await app.request('/api/focuses/focus-1/watches/trial', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/focuses/focus-1/monitors/news', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })).status).toBe(400);
  });
});

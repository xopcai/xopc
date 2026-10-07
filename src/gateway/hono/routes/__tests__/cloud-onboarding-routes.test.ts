import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerModelsRoutes } from '../models.js';

describe('Cloud onboarding routes', () => {
  let directory: string;
  let app: Hono;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-cloud-route-'));
    vi.stubEnv('XOPC_STATE_DIR', directory);
    app = new Hono();
    registerModelsRoutes(app, {
      service: { getModelCatalogSync: () => ({ getStatus: () => ({}) }) },
      strictRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports and persists a one-time dismissal', async () => {
    const initial = await app.request('/api/models/cloud-onboarding');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ ok: true, payload: { status: 'unseen' } });

    const dismissed = await app.request('/api/models/cloud-onboarding', { method: 'PUT' });
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toMatchObject({ payload: { status: 'dismissed' } });

    const next = await app.request('/api/models/cloud-onboarding');
    expect(await next.json()).toMatchObject({ payload: { status: 'dismissed' } });
  });
});

import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createEndpointPrincipal,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeEndpointPrincipal,
} from '../../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerEndpointToolRoutes } from '../endpoint-tools.js';

describe('endpoint tool principal routes', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-endpoint-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns a distinct error for a revoked principal', async () => {
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const registration = {
      principalId: crypto.randomUUID(),
      displayName: 'Browser',
      kind: 'web' as const,
      platform: 'web',
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    };
    createEndpointPrincipal({
      id: registration.principalId,
      displayName: registration.displayName,
      kind: registration.kind,
      platform: registration.platform,
      publicKey: registration.publicKey,
    });
    revokeEndpointPrincipal(registration.principalId);

    const app = new Hono();
    registerEndpointToolRoutes(app, { service: {} } as AuthenticatedRouteDeps);
    const response = await app.request('/api/endpoint-tools/principals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PRINCIPAL_REVOKED' },
    });
  });
});

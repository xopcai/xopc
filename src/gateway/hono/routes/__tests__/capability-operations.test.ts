import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import { registerCapabilityOperationRoutes } from '../capability-operations.js';

describe('capability operation authorization', () => {
  it('uses domain scopes, not gateway admin or status, for discovery and invocation', async () => {
    const app = new Hono();
    const listNotes = vi.fn(async () => ({ items: [], total: 0 }));
    app.use('*', async (c, next) => {
      setGatewayPrincipal(c, { kind: 'device', principalId: 'restricted-device', scopes: ['workspace.read'] });
      await next();
    });
    app.use('*', gatewayScopes());
    registerCapabilityOperationRoutes(app, {
      service: { notesServiceInstance: { listNotes } },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    const root = '/api/capabilities/operations';
    const response = await app.request(root);
    expect(response.status).toBe(200);
    const { capabilities } = await response.json();
    expect(capabilities.map((item: { id: string }) => item.id)).toEqual([
      'xopc.context.resolve', 'xopc.notes.preview_edit',
      'xopc.notes.project_summaries', 'xopc.notes.history', 'xopc.notes.snapshot', 'xopc.notes.get', 'xopc.notes.list',
    ]);
    expect((await app.request(`${root}/xopc.tasks.get`)).status).toBe(404);
    const descriptor = capabilities.find((item: { id: string }) => item.id === 'xopc.notes.list');
    const invoke = (input: unknown) => app.request(`${root}/${descriptor.id}/invocations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input }),
    });
    expect((await invoke({})).status).toBe(200);
    expect((await invoke({ surface: 'agent' })).status).toBe(400);
    expect(listNotes).toHaveBeenCalledTimes(1);
    expect((await app.request('/api/capabilities/operations-other')).status).toBe(403);
  });
});

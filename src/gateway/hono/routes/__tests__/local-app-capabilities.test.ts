import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import { createProductDispatcher } from '../../../../capabilities/runtime/product.js';
import { CapabilityError } from '../../../../capabilities/runtime/errors.js';
import { registerLocalAppCapabilityRoutes } from '../local-app-capabilities.js';

function setup(scopes: Array<'workspace.read' | 'tasks.read'> = ['workspace.read']) {
  const listNotes = vi.fn(async () => ({ items: [], total: 0 }));
  const dispatcher = createProductDispatcher(() => ({ listNotes }) as never);
  const descriptor = dispatcher.describe('xopc.notes.list', { principalId: 'test', scopes: ['workspace.read'], surface: 'http', authorize: () => true });
  const binding = { id: descriptor.id, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest };
  const access = vi.fn(() => ({ releaseId: 'release-1', bindings: [binding] }));
  const app = new Hono();
  app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind: 'device', principalId: 'device', scopes }); await next(); });
  app.use('*', gatewayScopes());
  registerLocalAppCapabilityRoutes(app, { service: { notesServiceInstance: { listNotes }, localApps: { getCapabilityAccess: access } },
    strictRateLimitMiddleware: async (_c, next) => next() } as never);
  const root = '/api/local-app-capabilities/fixture';
  const body = { manifestDigest: 'b'.repeat(64), call: { majorVersion: binding.majorVersion, descriptorDigest: binding.descriptorDigest, input: {} } };
  const invoke = (value: unknown = body, id = binding.id) => app.request(`${root}/${id}/invocations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  return { app, root, body, access, invoke, listNotes, binding };
}
describe('Local App capability host API', () => {
  it('discovers and calls only exact installed bindings under the authenticated domain scope', async () => {
    const { app, root, body, invoke, access, listNotes } = setup();
    const catalog = await app.request(`${root}?manifestDigest=${body.manifestDigest}`);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).capabilities).toHaveLength(1);
    expect((await invoke()).status).toBe(200);
    expect(access).toHaveBeenCalledWith('fixture', body.manifestDigest);
    expect(listNotes).toHaveBeenCalledTimes(1);
  });
  it('rejects undeclared capabilities, changed digests and caller identity injection', async () => {
    const { invoke, body, listNotes } = setup();
    expect((await invoke(body, 'xopc.notes.get')).status).toBe(403);
    expect((await invoke({ ...body, call: { ...body.call, descriptorDigest: 'c'.repeat(64) } })).status).toBe(409);
    expect((await invoke({ ...body, principalId: 'admin' })).status).toBe(400);
    expect(listNotes).not.toHaveBeenCalled();
  });
  it('never widens the authenticated caller scope', async () => {
    const { invoke, listNotes } = setup(['tasks.read']);
    expect((await invoke()).status).toBe(404);
    expect(listNotes).not.toHaveBeenCalled();
  });
  it('withholds results after revocation during a read', async () => {
    const { invoke, listNotes, access } = setup();
    listNotes.mockImplementation(async () => { access.mockImplementation(() => { throw new CapabilityError('FORBIDDEN', 'Revoked'); }); return { items: [], total: 0 }; });
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty('data');
  });
});

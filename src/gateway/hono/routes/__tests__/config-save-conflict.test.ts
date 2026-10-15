import { isDeepStrictEqual } from 'node:util';

import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../../../config/schema.js';
import { registerConfigRoutes } from '../config.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

const patch = vi.hoisted(() => ({ misc: vi.fn() }));
vi.mock('../config-patch/index.js', () => ({ applyChannelsPatch: () => {}, applyGatewayPatch: () => ({ ok: true }),
  applyMiscPatch: patch.misc, validateGatewayAfterPatch: () => ({ ok: true }) }));

it('retains the original expected snapshot across async patch preparation and reports concurrent service writes', async () => {
  const initial = ConfigSchema.parse({ mcp: { servers: { docs: { command: 'node' } } } });
  let current = structuredClone(initial);
  const save = vi.fn(async (next: Config, expected?: Config) => {
    if (!isDeepStrictEqual(current, expected)) return { saved: false, conflict: true, error: 'Concurrent update' };
    current = next; return { saved: true };
  });
  patch.misc.mockImplementationOnce(async (candidate: Config) => {
    candidate.mcp!.servers!.docs = { command: 'edited' };
    await Promise.resolve();
    current = structuredClone(current);
    current.mcp!.servers!.other = { command: 'created concurrently' };
    return { ok: true };
  });
  const app = new Hono();
  registerConfigRoutes(app, { service: { get currentConfig() { return current; }, saveConfig: save },
    strictRateLimitMiddleware: async (_context, next) => next(),
  } as unknown as AuthenticatedRouteDeps);
  const response = await app.request('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(409);
  expect(save).toHaveBeenCalledWith(expect.anything(), initial);
  expect(current.mcp!.servers!.docs.command).toBe('node');
  expect(current.mcp!.servers!.other.command).toBe('created concurrently');
});

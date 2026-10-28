import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';

import { registerPublicGatewayRoutes } from '../public-gateway.js';
import type { GatewayService } from '../../../service.js';

it('forwards only a bounded native response using the configured origin and clears it from navigation', async () => {
  const relayCallback = vi.fn(() => '/#/mcp-setup/goal');
  const app = new Hono();
  registerPublicGatewayRoutes(app, { currentConfig: { gateway: { publicUrl: 'https://gateway.example.com' } }, mcpSetup: { relayCallback } } as unknown as GatewayService);
  const response = await app.request('https://attacker.example/mcp-setup/callback/goal?state=state&code=private-code', { headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' } });
  expect(response.status).toBe(303);
  expect(response.headers.get('Location')).toBe('/#/mcp-setup/goal');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(relayCallback).toHaveBeenCalledWith('goal', 'https://gateway.example.com/mcp-setup/callback/goal?state=state&code=private-code');
  expect(await response.text()).not.toContain('private-code');
});

it('rejects duplicate or unrelated callback fields without calling native authorization', async () => {
  const relayCallback = vi.fn();
  const app = new Hono();
  registerPublicGatewayRoutes(app, { currentConfig: { gateway: { publicUrl: 'https://gateway.example.com' } }, mcpSetup: { relayCallback } } as unknown as GatewayService);
  for (const query of ['state=one&state=two&code=code', 'state=state&code=code&returnTo=https://attacker.example', `state=${'x'.repeat(8200)}`]) {
    expect((await app.request(`/mcp-setup/callback/goal?${query}`)).status).toBe(400);
  }
  expect(relayCallback).not.toHaveBeenCalled();
});

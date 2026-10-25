import { afterEach, describe, expect, it, vi } from 'vitest';

import { TunnelBrokerClient, TunnelBrokerError, TunnelRecoveryProofRejectedError, TunnelRegistrationKeyRejectedError } from '../broker-client.js';

vi.mock('../registration-proof.js', () => ({ createTunnelRegistrationProof: () => ({ version: 2 }) }));

afterEach(() => vi.restoreAllMocks());

describe('TunnelBrokerClient registration failures', () => {
  const client = new TunnelBrokerClient('https://broker.example/api');
  const input = { brokerUrl: 'https://broker.example/api', registrationSecret: 'rejected-key', gatewayVersion: 'test', platform: 'test' };

  it('identifies a rejected registration key for recovery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 }));
    await expect(client.register(input)).rejects.toBeInstanceOf(TunnelRegistrationKeyRejectedError);
  });

  it('keeps network/server failures separate from rejected keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }));
    await expect(client.register(input)).rejects.toEqual(new TunnelBrokerError(503, 'Tunnel register failed: 503'));
  });

  it('distinguishes rejected recovery proof from a rejected registration key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 'REGISTRATION_DENIED', error: 'Active lease ownership proof required' }, { status: 403 }));
    await expect(client.register(input)).rejects.toBeInstanceOf(TunnelRecoveryProofRejectedError);
  });

  it('does not treat a revoked tunnel token as a rejected registration key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    await expect(client.heartbeat('tunnel-id', 'revoked-token')).rejects.not.toBeInstanceOf(TunnelRegistrationKeyRejectedError);
  });
});

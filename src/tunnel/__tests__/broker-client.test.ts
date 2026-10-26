import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTunnelRegistrationProof } from '../registration-proof.js';
import { TunnelBrokerClient, TunnelBrokerError, TunnelRecoveryProofRejectedError, TunnelRegistrationKeyRejectedError } from '../broker-client.js';

vi.mock('../registration-proof.js', () => ({ createTunnelRegistrationProof: vi.fn(() => ({ version: 2 })) }));

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
  it('signs recovery for its own endpoint instead of reusing a registration proof', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }));
    await expect(client.recover(input)).rejects.toBeInstanceOf(TunnelBrokerError);
    expect(createTunnelRegistrationProof).toHaveBeenLastCalledWith({ ...input, brokerUrl: 'https://broker.example/api/tunnels/recover' });
    expect(request).toHaveBeenLastCalledWith('https://broker.example/api/tunnels/recover', expect.objectContaining({ method: 'POST' }));
  });

  it.each([403, 404, 503])('does not report a failed release (%s) as successful', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
    await expect(client.deregister('lease', 'token')).rejects.toBeInstanceOf(TunnelBrokerError);
  });

});

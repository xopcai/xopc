import { describe, expect, it, vi } from 'vitest';

import {
  provisionTunnelRegistrationKey,
  TunnelRegistrationProvisionError,
} from '../xopc-cloud-registration.js';

describe('provisionTunnelRegistrationKey', () => {
  it('exchanges the tunnel OAuth token without exposing it in the body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer oauth-token' });
      expect(String(init?.body)).not.toContain('oauth-token');
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'My gateway' });
      return Response.json({ key: 'xopc_reg_secret' }, { status: 201 });
    });

    await expect(provisionTunnelRegistrationKey({
      fetchImpl,
      routerUrl: 'https://router.test/v1/',
      resolveAccessToken: async () => 'oauth-token',
      deviceName: 'My gateway',
    })).resolves.toBe('xopc_reg_secret');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://router.test/v1/tunnel/registration-key',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires OAuth authorization', async () => {
    await expect(provisionTunnelRegistrationKey({
      resolveAccessToken: async () => null,
    })).rejects.toEqual(expect.objectContaining({
      code: 'tunnel_oauth_required',
      message: 'Authorize XOPC Public Tunnel before creating a registration key',
      status: 401,
    }));
  });

  it('preserves stable platform error details', async () => {
    const result = provisionTunnelRegistrationKey({
      resolveAccessToken: async () => 'oauth-token',
      fetchImpl: async () => Response.json({
        error: {
          code: 'tunnel_key_limit_reached',
          message: 'Maximum 10 tunnel keys allowed',
        },
      }, { status: 409 }),
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      name: 'TunnelRegistrationProvisionError',
      code: 'tunnel_key_limit_reached',
      message: 'Maximum 10 tunnel keys allowed',
      status: 409,
    } satisfies Partial<TunnelRegistrationProvisionError>));
  });
});

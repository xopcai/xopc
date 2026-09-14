import { hostname } from 'node:os';

import { z } from 'zod';

import { CredentialResolver } from '../auth/credentials.js';
import { resolveXopcModelRouterUrl } from '../providers/xopc-cloud-config.js';

const registrationResponseSchema = z.object({
  key: z.string().min(1),
});

const registrationErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  }),
});

type ProvisionOptions = {
  fetchImpl?: typeof fetch;
  routerUrl?: string;
  resolveAccessToken?: () => Promise<string | null>;
  deviceName?: string;
};

export class TunnelRegistrationProvisionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TunnelRegistrationProvisionError';
  }
}

function responseError(body: unknown, status: number): TunnelRegistrationProvisionError {
  const parsed = registrationErrorSchema.safeParse(body);
  const message = parsed.success
    ? parsed.data.error.message ?? `Tunnel registration failed (${status})`
    : `Tunnel registration failed (${status})`;
  const code = parsed.success
    ? parsed.data.error.code ?? 'tunnel_registration_failed'
    : 'tunnel_registration_failed';
  return new TunnelRegistrationProvisionError(message, code, status);
}

/** Exchange a narrowly scoped XOPC OAuth grant for a tunnel registration key. */
export async function provisionTunnelRegistrationKey(
  options: ProvisionOptions = {},
): Promise<string> {
  const resolveAccessToken = options.resolveAccessToken
    ?? (() => new CredentialResolver().resolveApiKey('xopc-tunnel'));
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new TunnelRegistrationProvisionError(
      'Authorize XOPC Public Tunnel before creating a registration key',
      'tunnel_oauth_required',
      401,
    );
  }

  const routerUrl = resolveXopcModelRouterUrl(options.routerUrl);
  const deviceName = options.deviceName?.trim() || hostname() || 'XOPC gateway';
  const response = await (options.fetchImpl ?? fetch)(`${routerUrl}/tunnel/registration-key`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: deviceName.slice(0, 64) }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw responseError(body, response.status);
  const parsed = registrationResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Tunnel registration returned an invalid response');
  return parsed.data.key;
}

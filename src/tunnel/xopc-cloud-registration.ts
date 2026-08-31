import { hostname } from 'node:os';

import { z } from 'zod';

import { CredentialResolver } from '../auth/credentials.js';
import { resolveXopcModelRouterUrl } from '../providers/xopc-cloud-config.js';

const registrationResponseSchema = z.object({
  key: z.string().min(1),
});

type ProvisionOptions = {
  fetchImpl?: typeof fetch;
  routerUrl?: string;
  resolveAccessToken?: () => Promise<string | null>;
  deviceName?: string;
};

function responseError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return `Tunnel registration failed (${status})`;
}

/** Exchange a narrowly scoped XOPC OAuth grant for a tunnel registration key. */
export async function provisionTunnelRegistrationKey(
  options: ProvisionOptions = {},
): Promise<string> {
  const resolveAccessToken = options.resolveAccessToken
    ?? (() => new CredentialResolver().resolveApiKey('xopc-tunnel'));
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Authorize XOPC Public Tunnel before creating a registration key');
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
  if (!response.ok) throw new Error(responseError(body, response.status));
  const parsed = registrationResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Tunnel registration returned an invalid response');
  return parsed.data.key;
}

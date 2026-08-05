import { z } from 'zod';

import { getCredentialResolver, type CredentialResolver } from '../auth/credentials.js';

const DEFAULT_ROUTER_URL = 'https://router.xopc.ai/v1';

const accountSummarySchema = z.object({
  balance: z.object({
    credits: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  }),
  usage: z.object({
    days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    averageLatencyMs: z.number().nonnegative(),
    chargedCredits: z.number().int().nonnegative(),
  }),
  links: z.object({
    details: z.string().url(),
    purchase: z.string().url(),
  }),
});

export type XopcCloudAccountSummary = z.infer<typeof accountSummarySchema>;

export class XopcCloudAccountError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'XopcCloudAccountError';
  }
}

export class XopcCloudAccountService {
  private readonly fetchImpl: typeof fetch;
  private readonly routerUrl: string;
  private readonly credentials: Pick<CredentialResolver, 'resolveApiKey'>;

  constructor(options: {
    fetchImpl?: typeof fetch;
    routerUrl?: string;
    credentials?: Pick<CredentialResolver, 'resolveApiKey'>;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.routerUrl = (options.routerUrl ?? process.env.XOPC_MODEL_ROUTER_URL ?? DEFAULT_ROUTER_URL).replace(/\/+$/, '');
    this.credentials = options.credentials ?? getCredentialResolver();
  }

  async getSummary(days: 1 | 7 | 30 = 7): Promise<XopcCloudAccountSummary | null> {
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud');
    if (!accessToken) return null;

    const response = await this.fetchImpl(`${this.routerUrl}/account/summary?days=${days}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null) as {
      error?: { message?: unknown; code?: unknown };
    } | null;
    if (!response.ok) {
      throw new XopcCloudAccountError(
        typeof body?.error?.message === 'string' ? body.error.message : `XOPC account summary failed (${response.status})`,
        response.status,
        typeof body?.error?.code === 'string' ? body.error.code : undefined,
      );
    }

    const parsed = accountSummarySchema.safeParse(body);
    if (!parsed.success) {
      throw new XopcCloudAccountError('XOPC account summary returned an invalid response', response.status, 'invalid_response');
    }
    return parsed.data;
  }
}

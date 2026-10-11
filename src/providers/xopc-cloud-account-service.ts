import { z } from 'zod';
import { cloudBillingReceiptSchema, cloudAccountSummarySchema, cloudCreditBudgetSchema, creditUnitSchema, creditMicroSchema, type CloudAccountSummary, type CloudCreditBudget, type CloudBillingReceipt } from '@xopcai/gateway-contract';

import { getProviderAuthService, type ProviderAuthService } from './provider-auth-service.js';
import { resolveXopcModelRouterUrl } from './xopc-cloud-config.js';

export type XopcCloudAccountSummary = CloudAccountSummary;

export class XopcCloudAccountError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'XopcCloudAccountError';
  }
}

export class XopcCloudAccountService {
  private readonly fetchImpl: typeof fetch;
  private readonly routerUrl: string;
  private readonly credentials: Pick<ProviderAuthService, 'resolveApiKey'>;

  constructor(options: {
    fetchImpl?: typeof fetch;
    routerUrl?: string;
    credentials?: Pick<ProviderAuthService, 'resolveApiKey'>;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.routerUrl = resolveXopcModelRouterUrl(options.routerUrl);
    this.credentials = options.credentials ?? getProviderAuthService();
  }

  private async request(path: string, init?: RequestInit): Promise<unknown | null> {
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud');
    if (!accessToken) return null;

    const response = await this.fetchImpl(`${this.routerUrl}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
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

    if (body === null) throw new XopcCloudAccountError('XOPC Cloud returned invalid JSON', 502, 'invalid_response');
    return body;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T | null {
    if (body === null) return null;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new XopcCloudAccountError('XOPC Cloud returned an invalid Credit response', 502, 'invalid_response');
    }
    return parsed.data;
  }

  async getSummary(days: 1 | 7 | 30 = 7): Promise<XopcCloudAccountSummary | null> {
    return this.parse(cloudAccountSummarySchema, await this.request(`/account/summary?version=2&days=${days}`));
  }

  async createBudget(limitCreditMicro: string, key: string): Promise<CloudCreditBudget | null> {
    creditMicroSchema.parse(limitCreditMicro);
    if (limitCreditMicro === '0' || limitCreditMicro.length > 15 || !/^[\w:.-]{8,128}$/.test(key)) {
      throw new Error('Invalid Credit budget');
    }
    const result = this.parse(z.object({ creditUnit: creditUnitSchema, budget: cloudCreditBudgetSchema }),
      await this.request('/account/budgets', { method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ limitCreditMicro }),
      }));
    return result?.budget ?? null;
  }

  async getReceipt(requestId: string): Promise<CloudBillingReceipt | null> {
    z.string().min(1).max(128).parse(requestId);
    const result = this.parse(z.object({ schemaVersion: z.literal(2), creditUnit: creditUnitSchema, receipt: cloudBillingReceiptSchema }),
      await this.request(`/account/receipts/${encodeURIComponent(requestId)}`));
    return result?.receipt ?? null;
  }

  async getBudget(id: string): Promise<CloudCreditBudget | null> {
    z.string().uuid().parse(id);
    const result = this.parse(z.object({ creditUnit: creditUnitSchema, budget: cloudCreditBudgetSchema }),
      await this.request(`/account/budgets/${encodeURIComponent(id)}`));
    return result?.budget ?? null;
  }
}

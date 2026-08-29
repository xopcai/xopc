import { randomUUID } from 'node:crypto';

import type { ToolRouterCreateSessionConfig } from '@composio/core';

import { getProviderAuthService, type ProviderAuthService } from '../providers/provider-auth-service.js';
import { resolveXopcModelRouterUrl } from '../providers/xopc-cloud-config.js';
import type {
  ComposioSessionLike,
  ComposioSessionsClient,
  ComposioToolkitAuthState,
} from './composio-sessions.js';

type JsonRecord = Record<string, unknown>;

class ManagedComposioError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ManagedComposioError';
  }
}

type ManagedRequest = {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

export class ManagedComposioClient implements ComposioSessionsClient {
  readonly mode = 'managed' as const;
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

  readonly sessions = {
    create: async (_userId: string, config: ToolRouterCreateSessionConfig = {}): Promise<ComposioSessionLike> => {
      if (config.authConfigs && Object.keys(config.authConfigs).length > 0) {
        throw new Error('Custom Composio auth configs require BYOK mode.');
      }
      const enabledToolkits = Array.isArray(config.toolkits)
        ? config.toolkits
        : config.toolkits && 'enable' in config.toolkits ? config.toolkits.enable : [];
      const connectedAccounts = Object.fromEntries(Object.entries(config.connectedAccounts ?? {}).map(
        ([toolkit, value]) => [toolkit, Array.isArray(value) ? value : [value]],
      ));
      return this.session(enabledToolkits, connectedAccounts);
    },
  };

  readonly connectedAccounts = {
    list: async (): Promise<unknown> => this.request<{ items: unknown[] }>({ path: '/connectors/composio/connections' }),
    delete: async (id: string): Promise<unknown> => this.request({
      path: `/connectors/composio/connections/${encodeURIComponent(id)}`,
      method: 'DELETE',
    }),
    refresh: async (id: string): Promise<unknown> => this.request({
      path: `/connectors/composio/connections/${encodeURIComponent(id)}/refresh`,
      method: 'POST',
    }),
  };

  readonly authConfigs = {
    list: async (): Promise<{ items: [] }> => ({ items: [] }),
  };

  readonly toolkits = {
    get: async (slug: string): Promise<{ composioManagedAuthSchemes?: string[]; authConfigDetails?: unknown[] }> => {
      const response = await this.request<{ auth: ComposioToolkitAuthState & { requiresByok?: boolean } }>({
        path: `/connectors/composio/toolkits/${encodeURIComponent(slug)}/auth`,
      });
      return {
        composioManagedAuthSchemes: response.auth.managedAuthAvailable ? ['OAUTH2'] : [],
        authConfigDetails: response.auth.requiresCustomAuthConfig ? [{}] : [],
      };
    },
  };

  async status(): Promise<{ configured: boolean; mode: 'managed' }> {
    return this.request({ path: '/connectors/composio/status' });
  }

  async events(after = 0, limit = 50): Promise<{
    items: Array<{ sequence: number; id: string; type: string; toolkit?: string; connectionId?: string; payload: unknown; createdAt: string }>;
    nextCursor: number;
  }> {
    return this.request({ path: `/connectors/composio/events?after=${after}&limit=${limit}` });
  }

  private session(toolkits: string[], connectedAccounts: Record<string, string[]>): ComposioSessionLike {
    const toolkit = () => {
      if (toolkits.length !== 1 || !toolkits[0]) throw new Error('Managed Composio sessions require exactly one toolkit for this operation.');
      return toolkits[0];
    };
    return {
      sessionId: 'managed',
      toolkits: async () => {
        const response = await this.request<{ items: Array<{
          slug: string;
          name: string;
          logo?: string;
          isNoAuth: boolean;
          connection?: { isActive: boolean; connectedAccount?: { status: string; id: string } };
        }> }>({ path: '/connectors/composio/toolkits' });
        return { items: response.items };
      },
      authorize: async (requestedToolkit: string, options) => {
        const response = await this.request<{ item: { id: string; status: string; redirectUrl?: string } }>({
          path: '/connectors/composio/authorizations',
          method: 'POST',
          body: { toolkit: requestedToolkit, alias: options?.alias },
        });
        return response.item;
      },
      search: async () => {
        const response = await this.request<{ result: unknown }>({
          path: `/connectors/composio/toolkits/${encodeURIComponent(toolkit())}/tools`,
        });
        return response.result;
      },
      execute: async (toolSlug: string, args: JsonRecord = {}, options) => {
        const selected = options?.account ?? connectedAccounts[toolkit()]?.[0];
        const response = await this.request<{ result: unknown }>({
          path: '/connectors/composio/execute',
          method: 'POST',
          body: { toolkit: toolkit(), toolSlug, args, ...(selected ? { accountId: selected } : {}) },
          headers: { 'idempotency-key': randomUUID() },
        });
        return response.result;
      },
    };
  }

  private async request<T = unknown>(input: ManagedRequest): Promise<T> {
    const accessToken = await this.credentials.resolveApiKey('xopc-cloud');
    if (!accessToken) {
      throw new ManagedComposioError('Sign in to XOPC Cloud to use managed app connections.', 401, 'xopc_cloud_not_configured');
    }
    const response = await this.fetchImpl(`${this.routerUrl}${input.path}`, {
      method: input.method ?? 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...input.headers,
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => null) as {
      error?: { message?: unknown; code?: unknown };
    } | null;
    if (!response.ok) {
      const code = typeof body?.error?.code === 'string' ? body.error.code : undefined;
      const fallback = response.status === 403 && code === 'insufficient_scope'
        ? 'Reconnect XOPC Cloud to grant app connection permissions.'
        : `Managed Composio request failed (${response.status})`;
      throw new ManagedComposioError(
        typeof body?.error?.message === 'string' ? body.error.message : fallback,
        response.status,
        code,
      );
    }
    return body as T;
  }
}

export async function inspectManagedComposioStatus(options: {
  fetchImpl?: typeof fetch;
  routerUrl?: string;
  credentials?: Pick<ProviderAuthService, 'resolveApiKey'>;
} = {}): Promise<{ configured: boolean; mode: 'managed'; reason?: string }> {
  try {
    const status = await new ManagedComposioClient(options).status();
    return { configured: status.configured, mode: 'managed', ...(!status.configured ? { reason: 'service_unavailable' } : {}) };
  } catch (error) {
    const reason = error instanceof ManagedComposioError && error.code === 'insufficient_scope'
      ? 'reauthorization_required'
      : error instanceof ManagedComposioError && error.status === 401
        ? 'signin_required'
        : 'service_unavailable';
    return { configured: false, mode: 'managed', reason };
  }
}

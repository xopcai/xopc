import { z } from 'zod';

import {
  AgentManifestSchema,
  PlatformDiscoverySchema,
  PlatformEventSchema,
  type PlatformDiscovery,
  type PlatformEvent,
} from './contracts.js';

export const PLATFORM_RUNTIME_PROVIDER = 'xopc-platform-runtime';
export const PLATFORM_RUNTIME_PROFILE = 'xopc-platform-runtime:default';

function trimBaseUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function discoverPlatform(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformDiscovery> {
  const response = await fetchImpl(`${trimBaseUrl(baseUrl)}/.well-known/xopc-platform`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Platform discovery failed with HTTP ${response.status}`);
  return PlatformDiscoverySchema.parse(await responseJson(response));
}

const runtimeIdentifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const runtimeCommandBase = {
  id: runtimeIdentifier,
  runId: runtimeIdentifier,
  leaseToken: z.string().min(1).max(512),
  leaseExpiresAt: z.number().int().positive(),
};

export const RuntimeCommandSchema = z.object({
  ...runtimeCommandBase,
  type: z.literal('run.start'),
  payload: z.object({
    runId: runtimeIdentifier,
    traceId: runtimeIdentifier,
    agentVersionId: runtimeIdentifier,
    organizationId: runtimeIdentifier,
    workspaceId: runtimeIdentifier,
    runtimeId: runtimeIdentifier,
    manifest: AgentManifestSchema,
  }).passthrough(),
}).strict().superRefine((command, context) => {
  if (command.payload.runId !== command.runId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Runtime command run identity does not match its payload',
      path: ['payload', 'runId'],
    });
  }
});

export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;

const runtimeLeaseResponseSchema = z.object({ command: RuntimeCommandSchema }).strict();
const runtimeRenewalResponseSchema = z.object({
  leaseExpiresAt: z.number().int().positive(),
  cancelRequested: z.boolean(),
}).strict();
export type RuntimeLeaseRenewal = z.infer<typeof runtimeRenewalResponseSchema>;

export class PlatformRuntimeClient {
  private readonly agentApi: string;

  constructor(
    discovery: PlatformDiscovery,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!discovery.capabilities.runtimeFleet || !discovery.endpoints.agentApi) {
      throw new Error('Connected platform does not provide a runtime fleet');
    }
    this.agentApi = discovery.endpoints.agentApi.replace(/\/+$/, '');
    if (!token.startsWith('xopc_rt_')) throw new Error('Invalid platform runtime token');
  }

  private async request(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.agentApi}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  async heartbeat(input: { capabilities?: Record<string, unknown>; endpoint?: string; leaseSeconds?: number } = {}): Promise<Record<string, unknown>> {
    const response = await this.request('/heartbeat', input);
    if (!response.ok) throw new Error(`Runtime heartbeat failed with HTTP ${response.status}`);
    return await responseJson(response) as Record<string, unknown>;
  }

  async lease(leaseSeconds = 30): Promise<RuntimeCommand | null> {
    const response = await this.request('/lease', { leaseSeconds });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Runtime lease failed with HTTP ${response.status}`);
    return runtimeLeaseResponseSchema.parse(await responseJson(response)).command;
  }

  async report(event: PlatformEvent, leaseToken?: string): Promise<'accepted' | 'duplicate'> {
    const response = await this.request('/events', { event: PlatformEventSchema.parse(event), leaseToken });
    if (!response.ok) throw new Error(`Runtime event failed with HTTP ${response.status}`);
    const value = await responseJson(response) as { status?: 'accepted' | 'duplicate' } | null;
    if (value?.status !== 'accepted' && value?.status !== 'duplicate') throw new Error('Runtime event response is incomplete');
    return value.status;
  }

  async renew(commandId: string, leaseToken: string, leaseSeconds = 60): Promise<RuntimeLeaseRenewal> {
    const response = await this.request(`/commands/${encodeURIComponent(commandId)}/renew`, { leaseToken, leaseSeconds });
    if (!response.ok) throw new Error(`Runtime lease renewal failed with HTTP ${response.status}`);
    return runtimeRenewalResponseSchema.parse(await responseJson(response));
  }
}

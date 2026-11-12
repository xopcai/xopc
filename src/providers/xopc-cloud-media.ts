import { z } from 'zod';

import { getModelCatalogStore } from './model-catalog-store.js';
import { getProviderAuthService } from './provider-auth-service.js';
import { resolveXopcModelRouterUrl } from './xopc-cloud-config.js';

export const CLOUD_MEDIA_PROVIDER = 'xopc-cloud';

export function getCloudMediaModels(kind: 'music' | 'video') {
  return getModelCatalogStore().getSource(CLOUD_MEDIA_PROVIDER)?.mediaGeneration?.models.filter(model => model.kind === kind) ?? [];
}

export function getCloudMediaDefault(kind: 'music' | 'video'): string | undefined {
  const manifest = getModelCatalogStore().getSource(CLOUD_MEDIA_PROVIDER)?.mediaGeneration;
  const id = manifest?.defaults[kind];
  return id && manifest?.models.some(model => model.id === id && model.kind === kind) ? `${CLOUD_MEDIA_PROVIDER}/${id}` : undefined;
}

export async function resolveCloudMediaToken(): Promise<string | undefined> {
  return (await getProviderAuthService().resolveApiKey(CLOUD_MEDIA_PROVIDER)) || undefined;
}

export class CloudMediaError extends Error {
  constructor(readonly status: number) {
    super(status === 402
      ? 'XOPC Cloud Credit balance or workspace budget is insufficient.'
      : `XOPC Cloud media request returned HTTP ${status}.`);
  }
}

const taskSchema = z.object({ id: z.string().uuid() });
const statusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('submitted') }),
  z.object({ state: z.literal('running') }),
  z.object({ state: z.literal('failed'), reason: z.literal('The media provider could not complete the task.') }),
  z.object({
    state: z.literal('completed'),
    url: z.string().url(),
    durationMs: z.number().int().positive().nullable().optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
]);

async function request(kind: 'music' | 'videos', token: string, task: string | undefined, input?: object) {
  const path = `/${kind}/generations${task ? `/${encodeURIComponent(task)}` : ''}`;
  const response = await fetch(`${resolveXopcModelRouterUrl()}${path}`, {
    method: input ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    body: input && JSON.stringify(input),
    signal: AbortSignal.timeout(35_000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new CloudMediaError(response.status);
  }
  return response.json();
}

export async function submitCloudMedia(kind: 'music' | 'videos', token: string, input: object) {
  return taskSchema.parse(await request(kind, token, undefined, input)).id;
}

export async function queryCloudMedia(kind: 'music' | 'videos', token: string, task: string) {
  return statusSchema.parse(await request(kind, token, task));
}

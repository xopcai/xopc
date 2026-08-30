import {
  parseHomeResponse,
  type HomeAttention,
  type HomeDecision,
  type HomeRunningConversation,
  type HomeWorkbenchItem,
} from '@xopcai/gateway-contract';

export type { HomeAction, HomeAttention, HomeDecision, HomeWorkbenchItem as HomeFocusItem } from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';
import type { Language } from '../stores/preferences-store';
export interface HomeData {
  runningConversations: HomeRunningConversation[];
  needsUser: HomeWorkbenchItem[];
  background: HomeWorkbenchItem[];
  backgroundCount: number;
}

export async function fetchHome(language: Language): Promise<HomeData> {
  const res = await apiFetch(`/api/home?locale=${encodeURIComponent(language)}`);
  if (!res.ok) throw new Error(`Failed to fetch home: ${res.status}`);
  const raw = await res.json() as unknown;
  const core = parseHomeResponse(raw);
  return {
    runningConversations: core.runningConversations,
    needsUser: core.needsUser,
    background: core.background,
    backgroundCount: core.backgroundCount,
  };
}

export async function respondToHomeDecision(
  response: NonNullable<HomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  const res = await apiFetch('/api/home/decisions/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...response, decision }),
  });
  if (!res.ok) throw new Error(`Failed to respond to decision: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: string }>;
}

export async function acknowledgeHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  const res = await apiFetch('/api/home/attention/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to acknowledge attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: 'acknowledged' }>;
}

export async function retryHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  const res = await apiFetch('/api/home/attention/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to retry attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; runId: string; sessionKey?: string }>;
}

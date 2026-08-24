import {
  parseHomeResponse,
  type HomeAttention,
  type HomeDecision,
  type HomeFocusItem,
  type HomeResponse,
} from '@xopcai/gateway-contract';

export type { HomeAction, HomeAttention, HomeDecision, HomeFocusItem } from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';
import type { Language } from '../stores/preferences-store';
import type { NoteIndexEntry } from './notes';

export type HomeGateway = {
  status: string;
  ready: boolean;
  httpListening: boolean;
  version: string;
  uptime: number;
  tunnel: {
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    publicUrl: string | null;
    connected: boolean;
  };
};

export type HomeWorkflowRun = HomeResponse['workflowRuns']['active'][number];

export interface HomeData {
  focusItems: [HomeFocusItem, ...HomeFocusItem[]];
  recentlyOpened: NoteIndexEntry[];
  inboxCount: number;
  chats: HomeResponse['chats'];
  gateway: HomeGateway;
  workflowRuns: {
    active: HomeWorkflowRun[];
  };
  upcomingAutomations: HomeResponse['upcomingAutomations'];
  tasks: HomeResponse['tasks'];
}

export async function fetchHome(language: Language): Promise<HomeData> {
  const res = await apiFetch(`/api/home?locale=${encodeURIComponent(language)}`);
  if (!res.ok) throw new Error(`Failed to fetch home: ${res.status}`);
  const raw = await res.json() as unknown;
  const core = parseHomeResponse(raw);
  const home = raw as HomeData;
  return {
    focusItems: core.focusItems as [HomeFocusItem, ...HomeFocusItem[]],
    recentlyOpened: home.recentlyOpened,
    inboxCount: home.inboxCount,
    chats: core.chats,
    gateway: home.gateway,
    workflowRuns: { active: home.workflowRuns.active },
    upcomingAutomations: home.upcomingAutomations,
    tasks: core.tasks,
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

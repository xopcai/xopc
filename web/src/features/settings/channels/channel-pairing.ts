import { useEffect } from 'react';

import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChannelPairingPendingItem = {
  senderId: string;
  codeLast4: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
  isStale?: boolean;
  meta?: Record<string, string>;
};

export type ChannelPairingState = {
  channel: string;
  accountId: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  pending: ChannelPairingPendingItem[];
  paired: {
    fromConfig: string[];
    fromCredentials: string[];
  };
};

export type ChannelPairingSummaryEntry = {
  pending: number;
  stale: number;
  atCapacity: boolean;
};

export type ChannelPairingSummary = Record<string, ChannelPairingSummaryEntry>;

const PAIRING_REALTIME_EVENTS = [
  'channels-pairing-requested',
  'channels-pairing-refreshed',
  'channels-pairing-approved',
  'channels-pairing-revoked',
  'channels-pairing-dismissed',
] as const;

export function channelPairingSummarySwrKey(): string {
  return apiUrl('/api/channels/pairing/summary');
}

export async function fetchChannelPairingSummary(): Promise<ChannelPairingSummary> {
  const res = await fetchJson<{ ok?: boolean; payload?: { summary?: ChannelPairingSummary } }>(
    channelPairingSummarySwrKey(),
  );
  return res.payload?.summary ?? {};
}

export function channelPairingStateSwrKey(channelId: string, accountId = 'default'): string {
  return apiUrl(
    `/api/channels/${encodeURIComponent(channelId)}/pairing?account=${encodeURIComponent(accountId || 'default')}`,
  );
}

export async function fetchChannelPairingState(channelId: string, accountId = 'default'): Promise<ChannelPairingState> {
  const res = await fetchJson<{ ok?: boolean; payload?: Partial<ChannelPairingState> }>(
    channelPairingStateSwrKey(channelId, accountId),
  );
  const p = res.payload;
  return {
    channel: p?.channel ?? channelId,
    accountId: p?.accountId ?? (accountId || 'default'),
    dmPolicy: p?.dmPolicy ?? 'pairing',
    pending: Array.isArray(p?.pending) ? p.pending : [],
    paired: {
      fromConfig: Array.isArray(p?.paired?.fromConfig) ? p.paired.fromConfig : [],
      fromCredentials: Array.isArray(p?.paired?.fromCredentials) ? p.paired.fromCredentials : [],
    },
  };
}

async function postOrDeletePairing(url: string, method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<void> {
  const res = await apiFetch(url, {
    method,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(parsed.error?.message ?? res.statusText);
  }
}

export async function approveChannelPairingSender(params: {
  channelId: string;
  senderId: string;
  accountId?: string;
}): Promise<void> {
  await postOrDeletePairing(
    apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/pairing/approve-sender`),
    'POST',
    { accountId: params.accountId || 'default', senderId: params.senderId },
  );
}

export async function approveChannelPairingCode(params: {
  channelId: string;
  code: string;
  accountId?: string;
}): Promise<void> {
  await postOrDeletePairing(
    apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/pairing/approve`),
    'POST',
    { accountId: params.accountId || 'default', code: params.code },
  );
}

export async function dismissChannelPairingSender(params: {
  channelId: string;
  senderId: string;
  accountId?: string;
}): Promise<void> {
  await postOrDeletePairing(
    apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/pairing/pending`),
    'DELETE',
    { accountId: params.accountId || 'default', senderId: params.senderId },
  );
}

export async function revokeChannelPairingSender(params: {
  channelId: string;
  senderId: string;
  accountId?: string;
}): Promise<void> {
  await postOrDeletePairing(
    apiUrl(`/api/channels/${encodeURIComponent(params.channelId)}/pairing/paired`),
    'DELETE',
    { accountId: params.accountId || 'default', senderId: params.senderId },
  );
}

export function subscribeChannelPairingRealtime(onEvent: (channelId?: string) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ channel?: string } | undefined>).detail;
    onEvent(typeof detail?.channel === 'string' ? detail.channel : undefined);
  };
  for (const name of PAIRING_REALTIME_EVENTS) {
    window.addEventListener(name, handler);
  }
  return () => {
    for (const name of PAIRING_REALTIME_EVENTS) {
      window.removeEventListener(name, handler);
    }
  };
}

export function useChannelPairingRealtime(onEvent: (channelId?: string) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeChannelPairingRealtime(onEvent);
  }, [enabled, onEvent]);
}

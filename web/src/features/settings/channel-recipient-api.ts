import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface ChannelStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface SessionChatId {
  channel: string;
  chatId: string;
  lastActive: string;
  accountId?: string;
  peerKind?: string;
  peerId?: string;
}

type LastActiveLabels = {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
};

function formatLastActive(date: string, labels: LastActiveLabels): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return labels.justNow;
  if (diff < 3_600_000) {
    return labels.minutesAgo.replace('{{count}}', String(Math.floor(diff / 60_000)));
  }
  if (diff < 86_400_000) {
    return labels.hoursAgo.replace('{{count}}', String(Math.floor(diff / 3_600_000)));
  }
  if (diff < 604_800_000) {
    return labels.daysAgo.replace('{{count}}', String(Math.floor(diff / 86_400_000)));
  }
  return new Date(date).toLocaleDateString();
}

export function formatRecipientOptionLabel(item: SessionChatId, labels: LastActiveLabels): string {
  const when = formatLastActive(item.lastActive, labels);
  if (item.channel === 'telegram' && item.peerId) {
    return `${item.accountId ?? 'default'} · ${item.peerKind ?? ''} · ${item.peerId} · ${when}`;
  }
  return `${item.channel}: ${item.chatId} · ${when}`;
}

export async function getChannels(): Promise<ChannelStatus[]> {
  const result = await fetchJson<{ ok: boolean; payload: { channels: ChannelStatus[] } }>(
    apiUrl('/api/channels/status'),
  );
  return result.payload?.channels || [];
}

export async function getSessionChatIds(channel?: string): Promise<SessionChatId[]> {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  const result = await fetchJson<{ ok: boolean; payload: { chatIds: SessionChatId[] } }>(
    apiUrl(`/api/sessions/chat-ids${query}`),
  );
  return result.payload?.chatIds || [];
}


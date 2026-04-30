import { apiFetch, formatApiHttpError } from '../api/client';

/** A single channel status entry from the gateway. */
export interface ChannelStatusEntry {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export async function fetchChannelsStatus(): Promise<ChannelStatusEntry[]> {
  const res = await apiFetch('/api/channels/status');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { channels?: unknown[] } };
  if (!data.payload?.channels || !Array.isArray(data.payload.channels)) {
    return [];
  }
  return data.payload.channels as ChannelStatusEntry[];
}

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function heartbeatMdSwrKey(): string {
  return apiUrl('/api/workspace/heartbeat-md');
}

export async function fetchHeartbeatMdSwr(): Promise<string> {
  const res = await fetchJson<{ ok?: boolean; payload?: { content?: string } }>(heartbeatMdSwrKey());
  return typeof res.payload?.content === 'string' ? res.payload.content : '';
}

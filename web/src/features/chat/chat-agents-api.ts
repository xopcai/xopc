import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChatAgentOption = { id: string; name?: string };

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
};

export async function fetchChatAgents(): Promise<ChatAgentsPayload> {
  const res = await apiFetch(apiUrl('/api/config'));
  if (!res.ok) throw new Error(`Config: HTTP ${res.status}`);
  const data = (await res.json()) as {
    payload?: {
      config?: {
        agents?: { defaultId?: string; list?: Array<{ id?: string; name?: string }> };
      };
    };
  };
  const agents = data.payload?.config?.agents;
  const defaultId = (agents?.defaultId ?? 'main').trim().toLowerCase();
  const raw = Array.isArray(agents?.list) ? agents.list : [];
  const items: ChatAgentOption[] = raw
    .filter((e): e is { id: string; name?: string } => Boolean(e && typeof e.id === 'string' && e.id.trim()))
    .map((e) => ({
      id: e.id.trim().toLowerCase(),
      name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : undefined,
    }));
  if (items.length === 0) {
    return { defaultId, items: [{ id: defaultId }] };
  }
  return { defaultId, items };
}

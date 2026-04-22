import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChatAgentOption = { id: string; name?: string; description?: string };

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
};

export async function fetchChatAgents(): Promise<ChatAgentsPayload> {
  const agentsRes = await apiFetch(apiUrl('/api/agents'));
  if (agentsRes.ok) {
    const data = (await agentsRes.json()) as {
      ok?: boolean;
      payload?: {
        defaultId?: string;
        agents?: Array<{ id?: string; name?: string; description?: string }>;
      };
    };
    if (data.ok && data.payload?.defaultId && Array.isArray(data.payload.agents)) {
      const defaultId = data.payload.defaultId.trim().toLowerCase();
      const items: ChatAgentOption[] = data.payload.agents
        .filter((a): a is { id: string; name?: string; description?: string } =>
          Boolean(a && typeof a.id === 'string' && a.id.trim()),
        )
        .map((a) => ({
          id: a.id.trim().toLowerCase(),
          name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined,
          description:
            typeof a.description === 'string' && a.description.trim() ? a.description.trim() : undefined,
        }));
      if (items.length > 0) {
        return { defaultId, items };
      }
    }
  }

  const data = (await fetchGatewayConfigSwrResponse()) as {
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
    .filter((e): e is { id: string; name?: string; description?: string } =>
      Boolean(e && typeof e.id === 'string' && e.id.trim()),
    )
    .map((e) => ({
      id: e.id.trim().toLowerCase(),
      name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : undefined,
      description:
        typeof e.description === 'string' && e.description.trim() ? e.description.trim() : undefined,
    }));
  if (items.length === 0) {
    return { defaultId, items: [{ id: defaultId }] };
  }
  return { defaultId, items };
}

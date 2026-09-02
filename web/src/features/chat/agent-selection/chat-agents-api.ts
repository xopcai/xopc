import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChatAgentOption = {
  id: string;
  name?: string;
  description?: string;
  avatar?: string;
  role?: string;
  responsibilities?: string[];
  skills?: string[];
};

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
};

let _chatAgentsInflight: Promise<ChatAgentsPayload> | null = null;

export async function fetchChatAgents(): Promise<ChatAgentsPayload> {
  if (_chatAgentsInflight) return _chatAgentsInflight;
  _chatAgentsInflight = fetchChatAgentsUncached().finally(() => {
    _chatAgentsInflight = null;
  });
  return _chatAgentsInflight;
}

async function fetchChatAgentsUncached(): Promise<ChatAgentsPayload> {
  const agentsRes = await apiFetch(apiUrl('/api/agents'));
  if (agentsRes.ok) {
    const data = (await agentsRes.json()) as {
      ok?: boolean;
      payload?: {
        defaultId?: string;
        agents?: Array<{
          id?: string;
          name?: string;
          description?: string;
          avatar?: string;
          effective?: { skills?: { mode?: string; include?: string[] } };
        }>;
      };
    };
    if (data.ok && data.payload?.defaultId && Array.isArray(data.payload.agents)) {
      const defaultId = data.payload.defaultId.trim().toLowerCase();
      const items: ChatAgentOption[] = data.payload.agents
        .filter((a): a is NonNullable<typeof a> & { id: string } =>
          Boolean(a && typeof a.id === 'string' && a.id.trim()),
        )
        .map((a) => ({
          id: a.id.trim().toLowerCase(),
          name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined,
          description:
            typeof a.description === 'string' && a.description.trim() ? a.description.trim() : undefined,
          ...(typeof a.avatar === 'string' && a.avatar.trim() ? { avatar: a.avatar.trim() } : {}),
          skills: (a.effective?.skills?.mode === 'selected' ? a.effective.skills.include ?? [] : []).filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          ),
        }));
      if (items.length > 0) {
        return { defaultId, items };
      }
    }
  }

  const data = (await fetchGatewayConfigSwrResponse()) as {
    payload?: {
      config?: {
        agents?: { defaultId?: string; list?: Array<{ id?: string }> };
      };
    };
  };
  const agents = data.payload?.config?.agents;
  const defaultId = (agents?.defaultId ?? 'main').trim().toLowerCase();
  const raw = Array.isArray(agents?.list) ? agents.list : [];
  const items: ChatAgentOption[] = raw
    .filter((e): e is { id: string } =>
      Boolean(e && typeof e.id === 'string' && e.id.trim()),
    )
    .map((e) => ({
      id: e.id.trim().toLowerCase(),
    }));
  if (items.length === 0) {
    return { defaultId, items: [{ id: defaultId }] };
  }
  return { defaultId, items };
}

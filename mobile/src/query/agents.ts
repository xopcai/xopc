import { agentsResponseSchema } from '../config/schema';
import { apiFetch, formatApiHttpError } from '../api/client';

export type ChatAgentOption = { id: string; name?: string; description?: string };

export type ChatAgentsPayload = {
  defaultId: string;
  items: ChatAgentOption[];
};

export async function fetchChatAgents(): Promise<ChatAgentsPayload> {
  const res = await apiFetch('/api/agents');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = await res.json();
  const parsed = agentsResponseSchema.safeParse(data);
  if (!parsed.success) {
    return { defaultId: 'main', items: [{ id: 'main' }] };
  }
  const { defaultId, agents } = parsed.data.payload;
  const items: ChatAgentOption[] = agents
    .filter((a) => a.id.trim())
    .map((a) => ({
      id: a.id.trim().toLowerCase(),
      name: a.name?.trim() || undefined,
      description: a.description?.trim() || undefined,
    }));
  if (items.length === 0) {
    return { defaultId: defaultId.trim().toLowerCase(), items: [{ id: 'main' }] };
  }
  return { defaultId: defaultId.trim().toLowerCase(), items };
}

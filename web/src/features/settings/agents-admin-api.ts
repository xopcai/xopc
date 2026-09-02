import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  AgentOverride,
  AgentModelsOverride,
  AgentProfile,
  SkillOverride,
  ToolPolicy,
  GatewayAgentEffectiveConfigPayload,
  GatewayAgentRow,
  GatewayAgentsPayload,
} from './types/agent-gateway';

export type * from './types/agent-gateway';

export async function fetchGatewayAgents(): Promise<GatewayAgentsPayload> {
  const response = await fetchJson<{ payload?: GatewayAgentsPayload }>(apiUrl('/api/agents'));
  if (!response.payload?.defaultId || !Array.isArray(response.payload.agents)) {
    throw new Error('Invalid /api/agents response');
  }
  return response.payload;
}

export async function fetchGatewayAgentEffectiveConfig(agentId: string): Promise<GatewayAgentEffectiveConfigPayload> {
  const response = await fetchJson<{ payload?: GatewayAgentEffectiveConfigPayload }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/effective-config`),
  );
  if (!response.payload?.config || !response.payload.sources) {
    throw new Error('Invalid effective agent config response');
  }
  return response.payload;
}

async function refresh(payload: GatewayAgentsPayload): Promise<void> {
  const { mutate } = await import('swr');
  await Promise.all([
    mutate('settings-gateway-agents', payload, { revalidate: false }),
    mutate('setup-checklist-agents', payload, { revalidate: false }),
    revalidateGatewayConfig(),
  ]);
}

export async function createGatewayAgent(body: {
  id?: string;
  profile: AgentProfile;
  workspace?: string;
}): Promise<GatewayAgentsPayload & { createdAgentId: string }> {
  const response = await fetchJson<{ payload?: { agentId: string; agents: GatewayAgentsPayload } }>(apiUrl('/api/agents'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.payload?.agentId || !response.payload.agents) throw new Error('Invalid create agent response');
  await refresh(response.payload.agents);
  return { ...response.payload.agents, createdAgentId: response.payload.agentId };
}

export async function updateGatewayAgent(
  agentId: string,
  patch: Partial<Omit<AgentOverride, 'id' | 'enabled' | 'workspace' | 'models' | 'skills' | 'tools' | 'workflows' | 'runtime'>> & {
    workspace?: string | null;
    models?: AgentModelsOverride | null;
    skills?: SkillOverride | null;
    tools?: Record<string, ToolPolicy> | null;
    workflows?: AgentOverride['workflows'] | null;
    runtime?: AgentOverride['runtime'] | null;
    setDefault?: boolean;
  },
): Promise<GatewayAgentsPayload> {
  const response = await fetchJson<{ payload?: GatewayAgentsPayload }>(apiUrl(`/api/agents/${encodeURIComponent(agentId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.payload) throw new Error('Invalid update agent response');
  await refresh(response.payload);
  return response.payload;
}

export async function deleteGatewayAgent(agentId: string, purge = false): Promise<GatewayAgentsPayload> {
  const response = await fetchJson<{ payload?: { agents: GatewayAgentsPayload } }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}${purge ? '?purge=1' : ''}`),
    { method: 'DELETE' },
  );
  if (!response.payload?.agents) throw new Error('Invalid delete agent response');
  await refresh(response.payload.agents);
  return response.payload.agents;
}

export function agentDisplayName(agent: GatewayAgentRow): string {
  return agent.override.profile?.name || agent.name || agent.id;
}

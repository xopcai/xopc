import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';

const CHANNEL_AGENT_BINDING_PRIORITY = 40;

export function channelAgentBindingId(channelId: string): string {
  return `ui:route:channel:${channelId.trim().toLowerCase()}`;
}

export function getChannelAgentBinding(
  bindings: GatewayConfigBinding[],
  channelId: string,
): string {
  const binding = bindings.find((candidate) => candidate.id === channelAgentBindingId(channelId));
  return binding?.agentId?.trim().toLowerCase() ?? '';
}

/**
 * Adds or removes the UI-managed channel-wide route. Account- and peer-specific
 * bindings remain intact and have higher priority where configured.
 */
export function mergeChannelAgentBinding(
  bindings: GatewayConfigBinding[],
  channelId: string,
  agentId: string,
): GatewayConfigBinding[] {
  const id = channelAgentBindingId(channelId);
  const next = bindings.filter((binding) => binding.id !== id);
  const normalizedAgentId = agentId.trim().toLowerCase();
  if (!normalizedAgentId) return next;

  return [
    ...next,
    {
      id,
      agentId: normalizedAgentId,
      priority: CHANNEL_AGENT_BINDING_PRIORITY,
      enabled: true,
      match: {
        channel: channelId.trim().toLowerCase(),
        accountId: '*',
      },
    },
  ];
}

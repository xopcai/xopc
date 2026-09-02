export type GatewayModelSetupConfig = {
  agents?: {
    default?: string;
    defaults?: { models?: { chat?: { primary?: string } } };
    list?: Array<{ id?: string; enabled?: boolean; models?: { chat?: { primary?: string } } }>;
  };
};

export function needsModelOrProviders(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return true;
  const agents = (config as GatewayModelSetupConfig).agents;
  if (!agents) return true;
  const globalModel = agents.defaults?.models?.chat?.primary?.trim() ?? '';
  const selected = agents.list?.find((agent) => agent.enabled !== false && agent.id === agents.default);
  return !(selected?.models?.chat?.primary?.trim() || globalModel);
}

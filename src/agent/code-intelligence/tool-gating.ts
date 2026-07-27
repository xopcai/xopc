export interface CodeIntelligenceAgentGateConfig {
  enabled?: boolean;
  agentIds?: readonly string[];
}

export function isCodeIntelligenceEnabledForAgent(
  config: CodeIntelligenceAgentGateConfig | undefined,
  agentId: string | undefined,
): boolean {
  return config?.enabled === true &&
    agentId !== undefined &&
    config.agentIds?.includes(agentId) === true;
}

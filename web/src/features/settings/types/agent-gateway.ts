export type GatewayAgentSkillsInfo = {
  defaults: string[];
  entry?: string[];
  effectiveAllowlist?: string[];
};

export type GatewayAgentToolsInfo = {
  defaultsDisable: string[];
  entryDisable: string[];
  effectiveDisable: string[];
};

export type GatewayAgentRow = {
  id: string;
  name?: string;
  workspace: string;
  bootstrapDir: string;
  model?: { primary?: string; fallbacks?: string[] };
  isDefault: boolean;
  skills: GatewayAgentSkillsInfo;
  tools: GatewayAgentToolsInfo;
};

export type GatewayAgentsPayload = {
  defaultId: string;
  agents: GatewayAgentRow[];
  builtinToolIds: string[];
};

export type GatewayConfigBinding = {
  id?: string;
  agentId: string;
  priority?: number;
  match: {
    channel: string;
    accountId?: string;
    peerKind?: string;
    peerId?: string;
    guildId?: string;
    teamId?: string;
  };
  enabled?: boolean;
};

export type SkillCatalogRow = {
  name: string;
  directoryId: string;
  description?: string;
  enabled?: boolean;
  hub?: {
    kind: 'git' | 'archive';
    source: string;
    ref?: string;
    updatedAt?: string;
  };
};

export type AgentBootstrapFileEntry = {
  name: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

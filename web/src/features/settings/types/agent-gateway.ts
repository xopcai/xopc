export type GatewayAgentSkillsInfo = {
  preset: string[];
  entry?: string[];
  effectiveAllowlist?: string[];
};

export type GatewayAgentToolsInfo = {
  presetDenied: string[];
  entryDisable: string[];
  effectiveDisable: string[];
};

export type GatewayAgentTypedModelsInfo = {
  defaultRole: string;
  preset: Array<{ id: string; model: string; fallbacks?: string[]; description?: string }>;
  entry?: Array<{ id: string; model: string; fallbacks?: string[]; description?: string }>;
  effective: Array<{ id: string; model: string; fallbacks?: string[]; description?: string }>;
};

export type GatewayAgentRow = {
  id: string;
  name?: string;
  description?: string;
  language?: string;
  /** From `IDENTITY.md` when gateway enriches `/api/agents`. */
  avatar?: string;
  workspace: string;
  profileDir: string;
  model?: { primary?: string; fallbacks?: string[] };
  typedModels: GatewayAgentTypedModelsInfo;
  extends: string[];
  isDefault: boolean;
  skills: GatewayAgentSkillsInfo;
  tools: GatewayAgentToolsInfo;
};

export type GatewayAgentsPayload = {
  defaultId: string;
  agents: GatewayAgentRow[];
  builtinToolIds: string[];
};

export type GatewayAgentEffectiveManifestPayload = {
  manifest: {
    id: string;
    enabled?: boolean;
    extends?: string[];
    identity?: {
      name?: string;
      role?: string;
      language?: string;
      tone?: string;
    };
    workspace?: { root?: string };
    models?: {
      defaultRole?: string;
      roles?: Record<string, { model: string; fallbacks?: string[]; description?: string }>;
    };
    tools?: {
      builtin?: Record<string, { mode: 'allow' | 'confirm' | 'deny'; scope?: string }>;
    };
    skills?: {
      mode?: 'all' | 'allowlist' | 'denylist' | 'off';
      allow?: string[];
      deny?: string[];
    };
    workflows?: {
      default?: string;
      allowed?: string[];
    };
    boundaries?: {
      requiresConfirmation?: string[];
      forbidden?: string[];
      escalation?: string[];
    };
  };
  presetChain?: string[];
  sources: Record<string, string>;
  overrides?: Array<{ path: string; from: string; to: string }>;
  locks?: string[];
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

export type AgentProfileFileEntry = {
  name: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

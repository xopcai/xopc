export type ModelRoute = { primary: string; fallbacks: string[] };
export type ModelIntent = 'fast' | 'reasoning' | 'coding' | 'review' | 'vision' | 'understanding';
export type AgentModelsDefaults = {
  chat: ModelRoute;
  intents: Partial<Record<ModelIntent, ModelRoute>>;
  imageUnderstanding?: ModelRoute;
  imageGeneration?: ModelRoute & { timeoutMs?: number; autoProviderFallback: boolean };
};
export type AgentModelsOverride = {
  chat?: ModelRoute;
  intents?: Partial<Record<ModelIntent, ModelRoute | null>>;
  imageUnderstanding?: ModelRoute | null;
  imageGeneration?: (ModelRoute & { timeoutMs?: number; autoProviderFallback: boolean }) | null;
};
export type ToolPolicy = { mode: 'allow' | 'ask' | 'deny'; maxCallsPerTurn?: number; timeoutMs?: number };
export type BuiltinToolSummary = { id: string; description: { en: string; zh: string } };
export type SkillDefaults =
  | { mode: 'all-enabled'; exclude: string[] }
  | { mode: 'selected'; include: string[] };
export type SkillOverride =
  | { mode: 'merge'; add: string[]; remove: string[] }
  | { mode: 'replace'; include: string[] };
export type AgentProfile = { name: string; instructions?: string };
export type AgentDefaults = {
  models: AgentModelsDefaults;
  skills: SkillDefaults;
  tools: Record<string, ToolPolicy>;
  workflows: { default?: string; allowed?: string[] };
  runtime: {
    maxTurns?: number;
    timeoutMs?: number;
    maxToolFailuresPerTurn?: number;
    promptCache?: { mode: 'off' | 'auto'; lifetime: 'short' | 'long' };
  };
};
export type AgentOverride = {
  id: string;
  enabled: boolean;
  workspace?: string;
  profile?: AgentProfile;
  models?: AgentModelsOverride;
  skills?: SkillOverride;
  tools?: Record<string, ToolPolicy>;
  workflows?: AgentDefaults['workflows'];
  runtime?: AgentDefaults['runtime'];
};
export type EffectiveAgentConfig = Omit<AgentOverride, 'models' | 'skills' | 'tools' | 'workspace'> & {
  workspace: string;
  models: AgentModelsDefaults;
  skills: SkillDefaults;
  tools: Record<string, ToolPolicy>;
  workflows: AgentDefaults['workflows'];
  runtime: AgentDefaults['runtime'];
};
export type GatewayAgentRow = {
  id: string;
  name: string;
  description?: string;
  language?: string;
  avatar?: string;
  workspace: string;
  profileDir: string;
  override: AgentOverride;
  effective: EffectiveAgentConfig;
  sources: Record<string, 'system' | 'global' | 'agent'>;
  isDefault: boolean;
};
export type GatewayAgentsPayload = { defaultId: string; agents: GatewayAgentRow[]; builtinToolIds: string[] };
export type GatewayAgentEffectiveConfigPayload = {
  config: EffectiveAgentConfig;
  sources: Record<string, 'system' | 'global' | 'agent'>;
};

export type GatewayConfigBinding = {
  id?: string;
  agentId: string;
  priority?: number;
  match: { channel: string; accountId?: string; peerKind?: string; peerId?: string };
  enabled?: boolean;
};

export type AgentProfileFileEntry = { name: string; missing: boolean; size?: number; updatedAtMs?: number };
export type SkillCatalogRow = { name: string; description?: string; availableForCurrentAgent?: boolean };

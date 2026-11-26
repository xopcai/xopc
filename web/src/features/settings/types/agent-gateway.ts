import type { ModelThinkingCapabilities, SpecialistProfile } from '@xopcai/gateway-contract';

export type ModelRoute = { primary: string; fallbacks: string[] };
export type ModelIntent = 'fast' | 'reasoning' | 'coding' | 'review' | 'vision' | 'understanding';
export type AgentModelsDefaults = {
  computerUse?: ModelRoute;
  phoneUse?: ModelRoute;
  chat: ModelRoute;
  background?: ModelRoute;
  intents: Partial<Record<ModelIntent, ModelRoute>>;
  imageUnderstanding?: ModelRoute;
  imageGeneration?: ModelRoute & { timeoutMs?: number; autoProviderFallback: boolean };
};
export type AgentModelsOverride = {
  computerUse?: ModelRoute | null;
  phoneUse?: ModelRoute | null;
  chat?: ModelRoute;
  background?: ModelRoute | null;
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
export type AgentProfile = {
  name: string;
  description?: string;
  creature?: string;
  style?: string;
  language?: string;
  emoji?: string;
  avatar?: string;
  instructions?: string;
};
export type AgentDefaults = {
  models: AgentModelsDefaults;
  skills: SkillDefaults;
  tools: Record<string, ToolPolicy>;
  runtime: {
    codemode?: { enabled: boolean; timeoutMs?: number; maxConcurrentCalls?: number; maxCalls?: number; maxOutputTokens?: number };
    cloudCreditLimitPerRunMicro?: string;
    maxTurns?: number;
    timeoutMs?: number;
    maxToolFailuresPerTurn?: number;
    promptCache?: { mode: 'off' | 'auto'; lifetime: 'short' | 'long' };
  };
};
export const EXTERNAL_AGENT_KINDS = ['codex', 'agy'] as const;
export type ExternalAgentKind = (typeof EXTERNAL_AGENT_KINDS)[number];

export const EXTERNAL_PERMISSION_MODES = ['full_access', 'auto_edit', 'ask'] as const;
export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number];

export const AGY_AUTH_METHODS = ['oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'] as const;
export type AgyAuthMethod = (typeof AGY_AUTH_METHODS)[number];

export type CodexExecution = {
  kind: 'codex';
  binaryPath?: string;
  homePath?: string;
  model?: string;
  permissionMode?: ExternalPermissionMode;
};

export type AgyExecution = {
  kind: 'agy';
  binaryPath?: string;
  geminiDir?: string;
  authMethod?: AgyAuthMethod;
  model?: string;
  permissionMode?: ExternalPermissionMode;
};

export type ExternalAgentExecution = CodexExecution | AgyExecution;

export type ExternalRuntimeStatus = 'ready' | 'not_installed' | 'unauthenticated' | 'warning' | 'error';

export type ExternalRuntimeModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  thinking?: ModelThinkingCapabilities;
  thinkingConfigId?: string;
};

export type ExternalRuntimeAccountInfo = {
  label?: string;
  authMode?: string;
};

export type ExternalRuntimeProbeResult = {
  kind: ExternalAgentKind;
  label: string;
  installed: boolean;
  status: ExternalRuntimeStatus;
  executablePath?: string;
  version?: string;
  account?: ExternalRuntimeAccountInfo;
  message?: string;
  hintCommand?: string;
  models: ExternalRuntimeModelOption[];
  checkedAt: number;
};

export type ExternalRuntimeAuthMode = 'browser' | 'device_code' | 'api_key';

export type ExternalRuntimeAuthPhase =
  | 'starting'
  | 'waiting'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ExternalRuntimeAuthInputKind = 'code_or_url' | 'callback_url';

export type ExternalRuntimeAuthFlowSnapshot = {
  flowId: string;
  kind: ExternalAgentKind;
  mode: ExternalRuntimeAuthMode;
  phase: ExternalRuntimeAuthPhase;
  authorizationUrl?: string;
  userCode?: string;
  inputKind?: ExternalRuntimeAuthInputKind;
  message?: string;
  probe?: ExternalRuntimeProbeResult;
  expiresAt: string;
};

export function isExternalAgentKind(value: unknown): value is ExternalAgentKind {
  return typeof value === 'string' && (EXTERNAL_AGENT_KINDS as readonly string[]).includes(value);
}

export type AgentOverride = {
  id: string;
  enabled: boolean;
  purpose?: 'specialist' | 'task_dispatcher';
  workspace?: string;
  profile?: AgentProfile;
  specialistProfile?: SpecialistProfile;
  execution?: ExternalAgentExecution;
  models?: AgentModelsOverride;
  skills?: SkillOverride;
  tools?: Record<string, ToolPolicy>;
  toolAllowlist?: string[];
  runtime?: AgentDefaults['runtime'];
};
export type EffectiveAgentConfig = Omit<AgentOverride, 'models' | 'skills' | 'tools' | 'workspace'> & {
  workspace: string;
  models: AgentModelsDefaults;
  skills: SkillDefaults;
  tools: Record<string, ToolPolicy>;
  toolAllowlist?: string[];
  runtime: AgentDefaults['runtime'];
};
export type GatewayAgentRow = {
  id: string;
  revision?: number;
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

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
export const EXTERNAL_AGENT_KINDS = ['codex', 'agy', 'claude'] as const;
export type ExternalAgentKind = (typeof EXTERNAL_AGENT_KINDS)[number];

export const EXTERNAL_PERMISSION_MODES = ['full_access', 'auto_edit', 'ask'] as const;
export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number];

export const EXTERNAL_CONTEXT_ACCESS_MODES = ['off', 'brief_only', 'read_only', 'read_write'] as const;
export type ExternalContextAccess = (typeof EXTERNAL_CONTEXT_ACCESS_MODES)[number];

export const AGY_AUTH_METHODS = ['oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'] as const;
export type AgyAuthMethod = (typeof AGY_AUTH_METHODS)[number];

export type CodexExecution = {
  kind: 'codex';
  binaryPath?: string;
  homePath?: string;
  model?: string;
  serviceTier?: string;
  permissionMode?: ExternalPermissionMode;
  contextAccess?: ExternalContextAccess;
};

export type AgyExecution = {
  kind: 'agy';
  binaryPath?: string;
  geminiDir?: string;
  authMethod?: AgyAuthMethod;
  model?: string;
  permissionMode?: ExternalPermissionMode;
  contextAccess?: ExternalContextAccess;
};

export type ClaudeExecution = {
  kind: 'claude';
  binaryPath?: string;
  configDir?: string;
  model?: string;
  permissionMode?: ExternalPermissionMode;
  contextAccess?: ExternalContextAccess;
};

export type ExternalAgentExecution = CodexExecution | AgyExecution | ClaudeExecution;

export type ExternalRuntimeStatus = 'ready' | 'not_installed' | 'unauthenticated' | 'warning' | 'error';

export type ExternalRuntimeServiceTier = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};

export type ExternalRuntimeModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  thinking?: ModelThinkingCapabilities;
  thinkingConfigId?: string;
  serviceTiers?: ExternalRuntimeServiceTier[];
};

export type ExternalRuntimeRateLimitWindow = {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
};

export type ExternalRuntimeRateLimits = {
  planLabel?: string;
  primary?: ExternalRuntimeRateLimitWindow;
  secondary?: ExternalRuntimeRateLimitWindow;
};

export type ExternalRuntimeCommand = {
  name: string;
  description?: string;
  source: 'skill' | 'command';
};

export type ExternalRuntimeAccountInfo = {
  label?: string;
  authMode?: string;
};

export type ExternalRuntimeFastDetection = {
  kind: ExternalAgentKind;
  label: string;
  installed: boolean;
  executablePath?: string;
  checkedAt: number;
};

export type ExternalRuntimeProbeResult = {
  kind: ExternalAgentKind;
  label: string;
  installed: boolean;
  status: ExternalRuntimeStatus;
  executablePath?: string;
  version?: string;
  account?: ExternalRuntimeAccountInfo;
  rateLimits?: ExternalRuntimeRateLimits;
  commands?: ExternalRuntimeCommand[];
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

export type QuickSetupExternalRuntimeItem = {
  kind: ExternalAgentKind;
  name?: string;
  model?: string;
  permissionMode?: ExternalPermissionMode;
  contextAccess?: ExternalContextAccess;
  authMethod?: AgyAuthMethod;
};

export type QuickSetupExternalRuntimeResultItem = {
  kind: ExternalAgentKind;
  agentId?: string;
  created: boolean;
  reusedExisting?: boolean;
  status: 'ok' | 'error';
  error?: string;
};

export type QuickSetupExternalRuntimesPayload = {
  results: QuickSetupExternalRuntimeResultItem[];
  agents: GatewayAgentsPayload;
};

export type AgentProfileFileEntry = { name: string; missing: boolean; size?: number; updatedAtMs?: number };
export type SkillCatalogRow = { name: string; description?: string; availableForCurrentAgent?: boolean };

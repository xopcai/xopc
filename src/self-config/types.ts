export type SelfConfigDomain =
  | 'all'
  | 'models'
  | 'voice'
  | 'web_search'
  | 'channels'
  | 'browser'
  | 'phone'
  | 'computer'
  | 'profile'
  | 'appearance'
  | 'compaction';

export type SelfConfigTier = 1 | 2 | 3;

export type SelfConfigAvatarTarget = 'user' | 'agent' | 'personal_agent';

export type SetupSceneId =
  | 'models'
  | 'web_search'
  | 'voice'
  | 'channels'
  | 'computer'
  | 'browser'
  | 'phone'
  | 'mcp';

export type ManagedSetupSceneId = 'models' | 'web_search' | 'voice' | 'channels' | 'computer';

export interface SelfConfigFieldDiff {
  field: string;
  before?: string;
  after?: string;
}

export interface SelfConfigChangeReceipt {
  changeId: string;
  conversationId?: string;
  tier: 1 | 2;
  target: string;
  title: string;
  summary: string;
  settingsSection: string;
  changes: SelfConfigFieldDiff[];
  createdAt: number;
  rolledBackAt?: number;
  canRollback: boolean;
}

export interface SelfConfigDomainStatus {
  domain: Exclude<SelfConfigDomain, 'all'>;
  configured: boolean;
  ready: boolean;
  blockers: string[];
  summary: string;
  details: Record<string, unknown>;
  settingsSection: string;
  setupScene?: SetupSceneId;
  nextAction?: string;
}

export interface SelfConfigInspectResult {
  ok: true;
  revision: string;
  domain: SelfConfigDomain;
  domains: SelfConfigDomainStatus[];
  blockers: Array<{
    domain: Exclude<SelfConfigDomain, 'all'>;
    reason: string;
    setupScene?: SetupSceneId;
    nextAction?: string;
  }>;
  summary: string;
}

export interface SelfConfigMutationResult {
  ok: boolean;
  dryRun?: boolean;
  requiresConfirmation?: boolean;
  requiresInteraction?: boolean;
  tier?: SelfConfigTier;
  setupScene?: SetupSceneId;
  settingsSection?: string;
  interactionPath?: string;
  receipt?: SelfConfigChangeReceipt;
  summary?: string;
  error?: string;
}

export type SetupSceneState =
  | 'inspecting'
  | 'needs_input'
  | 'ready_to_verify'
  | 'completed'
  | 'cancelled';

export interface UnifiedSetupRun {
  id: string;
  scene: ManagedSetupSceneId;
  conversationId: string;
  agentId: string;
  revision: number;
  state: SetupSceneState;
  resumeObjective?: string;
  target?: Record<string, string>;
  checks: {
    configured: boolean;
    verified: boolean;
  };
  missingSteps: string[];
  summary: string;
  interactionPath: string;
  settingsPath: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

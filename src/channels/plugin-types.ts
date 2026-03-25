/**
 * Channel Plugin Types - Core type definitions for channel plugins
 */

import type { Config } from '../config/index.js';
import type { MessageBus } from '../infra/bus/index.js';

import type { ChannelId, ChannelMeta, ChannelCapabilities } from './plugins/types.core.js';
import type {
  ChannelPairingAdapter,
  ChannelAllowlistAdapter,
  ChannelThreadingAdapter,
  ChannelLifecycleAdapter,
  ChannelHeartbeatAdapter,
  ChannelConfiguredBindingProvider,
  ChannelMessagingAdapter,
  ChannelDirectoryAdapter,
  ChannelResolverAdapter,
  ChannelAuthAdapter,
  ChannelElevatedAdapter,
  ChannelExecApprovalAdapter,
  ChannelAgentPromptAdapter,
  ChannelSetupWizard,
} from './plugins/types.adapters.js';

export type { ChannelId, ChatType, ChannelMeta, ChannelCapabilities } from './plugins/types.core.js';

import type { DmPolicy, GroupPolicy } from './channel-domain.js';

export type { DmPolicy, GroupPolicy };

// ============================================
// Configuration Types
// ============================================
export type ReplyToMode = 'off' | 'first' | 'all';
export type StreamMode = 'off' | 'partial' | 'block';

export interface ChannelConfigUiHint {
  label?: string;
  help?: string;
  tags?: string[];
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  itemTemplate?: unknown;
}

export interface ChannelConfigSchema {
  schema: Record<string, unknown>;
  uiHints?: Record<string, ChannelConfigUiHint>;
}

// ============================================
// Resolved Account
// ============================================

export interface ChannelAccountSnapshot {
  accountId: string;
  channelId: string;
  enabled: boolean;
  configured: boolean;
  status?: string;
  error?: string;
  lastSeen?: number;
}

// ============================================
// Channel Plugin Interface
// ============================================

/** Wired from Gateway so channel UIs (e.g. Telegram inline keyboards) use the same model store as AgentService. */
export interface ChannelPluginSessionModelHooks {
  getModelForSession: (sessionKey: string) => string;
  switchModelForSession: (sessionKey: string, modelId: string) => Promise<boolean>;
}

export interface ChannelPluginInitOptions {
  bus: MessageBus;
  config: Config;
  channelConfig: Record<string, unknown>;
  sessionModel?: ChannelPluginSessionModelHooks;
}

export interface ChannelPluginStartOptions {
  accountId?: string;
}

/** Default tuning for queue, outbound, and streaming (single source for plugins + dock). */
export interface ChannelPluginDefaults {
  queue?: {
    debounceMs?: number;
  };
  outbound?: {
    textChunkLimit?: number;
  };
  streaming?: {
    blockStreamingCoalesce?: {
      minChars?: number;
      idleMs?: number;
    };
  };
}

export interface ChannelPluginReloadMeta {
  /** Config path prefixes that hot-reload this plugin (for docs and tooling). */
  configPrefixes: string[];
}

export interface ChannelPlugin<ResolvedAccount = any> {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  defaults?: ChannelPluginDefaults;

  reload?: ChannelPluginReloadMeta;

  init(options: ChannelPluginInitOptions): Promise<void>;

  start(options?: ChannelPluginStartOptions): Promise<void>;

  stop(accountId?: string): Promise<void>;

  channelIsRunning?(cfg: Config): boolean;

  onConfigUpdated?(cfg: Config): void | Promise<void>;

  extensionManagedConfig?: boolean;

  /** Required account/config surface (OpenClaw: formerly configAdapter). */
  config: ChannelConfigAdapter<ResolvedAccount>;

  configSchema?: ChannelConfigSchema;

  setup?: ChannelSetupAdapter;

  setupWizard?: ChannelSetupWizard;

  outbound?: ChannelOutboundAdapter;

  streaming?: ChannelStreamingAdapter;

  security?: ChannelSecurityAdapter<ResolvedAccount>;

  pairing?: ChannelPairingAdapter;

  allowlist?: ChannelAllowlistAdapter;

  groups?: ChannelGroupAdapter;

  mentions?: ChannelMentionAdapter;

  messaging?: ChannelMessagingAdapter;

  threading?: ChannelThreadingAdapter;

  bindings?: ChannelConfiguredBindingProvider;

  gateway?: ChannelGatewayAdapter<ResolvedAccount>;

  lifecycle?: ChannelLifecycleAdapter;

  status?: ChannelStatusAdapter<ResolvedAccount>;

  directory?: ChannelDirectoryAdapter;

  resolver?: ChannelResolverAdapter;

  commands?: ChannelCommandAdapter;

  actions?: ChannelMessageActionAdapter;

  auth?: ChannelAuthAdapter;

  elevated?: ChannelElevatedAdapter;

  execApprovals?: ChannelExecApprovalAdapter;

  heartbeat?: ChannelHeartbeatAdapter;

  agentPrompt?: ChannelAgentPromptAdapter;

  agentTools?: ChannelAgentTool[];
}

// ============================================
// Config Adapter
// ============================================

export interface ChannelConfigAdapter<ResolvedAccount> {
  /** List all account IDs */
  listAccountIds(cfg: Config): string[];
  
  /** Resolve account configuration */
  resolveAccount(cfg: Config, accountId?: string | null): ResolvedAccount;
  
  /** Check if account is configured */
  isConfigured?(account: ResolvedAccount, cfg: Config): boolean | Promise<boolean>;
  
  /** Get unconfigured reason */
  unconfiguredReason?(account: ResolvedAccount, cfg: Config): string;
  
  /** Check if account is enabled */
  isEnabled?(account: ResolvedAccount, cfg: Config): boolean;
  
  /** Get disabled reason */
  disabledReason?(account: ResolvedAccount, cfg: Config): string;
  
  /** Describe account status */
  describeAccount?(account: ResolvedAccount, cfg: Config): ChannelAccountSnapshot;
  
  /** Resolve AllowFrom list */
  resolveAllowFrom?(params: {
    cfg: Config;
    accountId?: string | null;
  }): Array<string | number> | undefined;

  defaultAccountId?(cfg: Config): string;

  resolveDefaultTo?(params: { cfg: Config; accountId?: string | null }): string | undefined;

  formatAllowFrom?(params: { allowFrom: Array<string | number> }): string[];

  setAccountEnabled?(params: {
    cfg: Config;
    accountId: string;
    enabled: boolean;
  }): Config;

  deleteAccount?(params: { cfg: Config; accountId: string }): Config;
}

// ============================================
// Setup Adapter
// ============================================

export interface ChannelSetupAdapter {
  resolveAccountId?(params: {
    cfg: Config;
    accountId?: string;
    input?: ChannelSetupInput;
  }): string;
  
  applyAccountConfig(params: {
    cfg: Config;
    accountId: string;
    input: ChannelSetupInput;
  }): Config;
  
  validateInput?(params: {
    cfg: Config;
    accountId: string;
    input: ChannelSetupInput;
  }): string | null;
}

export interface ChannelSetupInput {
  botToken?: string;
  botTokenFile?: string;
  [key: string]: unknown;
}

// ============================================
// Outbound Adapter
// ============================================

export type ChannelOutboundTargetMode = 'default' | 'thread' | 'channel';

export type ChannelOutboundMediaType = 'photo' | 'video' | 'audio' | 'document' | 'animation';

export interface ChannelOutboundContext {
  cfg: Config;
  to: string;
  text: string;
  mediaUrl?: string;
  /** Hint for remote URL fetch + send (e.g. photo vs document). */
  mediaType?: ChannelOutboundMediaType;
  mediaLocalRoots?: readonly string[];
  gifPlayback?: boolean;
  forceDocument?: boolean;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
  silent?: boolean;
  audioAsVoice?: boolean;
}

export interface ChannelOutboundPayloadContext extends ChannelOutboundContext {
  payload: unknown; // ReplyPayload
}

export interface OutboundDeliveryResult {
  messageId: string;
  chatId: string;
  success: boolean;
  error?: string;
}

/** Agent response */
export interface AgentResponse {
  /** Reply content */
  content: string;
  /** Media attachments */
  media?: Array<{ type: string; url: string; caption?: string }>;
  /** Quick buttons */
  buttons?: Array<{ text: string; callback_data?: string; url?: string }>;
  /** Send as voice */
  asVoice?: boolean;
  /** Skill invocation */
  skill?: string;
  /** Wait for user approval */
  waitForApproval?: boolean;
}

export interface ChannelOutboundAdapter {
  /** Delivery mode */
  deliveryMode: 'direct' | 'gateway' | 'hybrid';
  
  /** Text chunker */
  chunker?: ((text: string, limit: number) => string[]) | null;
  
  /** Chunker mode */
  chunkerMode?: 'text' | 'markdown';
  
  /** Text chunk limit */
  textChunkLimit?: number;
  
  /** Poll options limit */
  pollMaxOptions?: number;
  
  /** Resolve target */
  resolveTarget?(params: {
    cfg?: Config;
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: ChannelOutboundTargetMode;
  }): { ok: true; to: string } | { ok: false; error: Error };
  
  /** Send full payload */
  sendPayload?(ctx: ChannelOutboundPayloadContext): Promise<OutboundDeliveryResult>;
  
  /** Send text */
  sendText?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  
  /** Send media */
  sendMedia?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  
  /** Send poll */
  sendPoll?(ctx: ChannelPollContext): Promise<ChannelPollResult>;
}

export interface ChannelPollContext {
  question: string;
  options: string[];
  ctx: ChannelOutboundContext;
}

export interface ChannelPollResult {
  messageId: string;
  success: boolean;
  error?: string;
}

// ============================================
// Streaming Adapter
// ============================================

export interface ChannelStreamHandle {
  update: (text: string) => void;
  updateProgress?: (text: string, stage: string, detail?: string) => void;
  setProgress?: (stage: string, detail?: string) => void;
  end: () => Promise<void>;
  abort: () => Promise<void>;
  messageId: () => number | undefined;
  /** When true after end(), the final outbound text was already shown via streaming — skip duplicate send. */
  skipFinalOutbound?: () => boolean;
}

export interface ChannelStreamingAdapter {
  /** Start streaming message */
  startStream(options: {
    chatId: string;
    accountId?: string;
    threadId?: string;
    replyToMessageId?: string;
    parseMode?: 'Markdown' | 'HTML';
  }): ChannelStreamHandle | null;
}

// ============================================
// Security Adapter
// ============================================

export interface ChannelSecurityDmPolicy {
  policy: DmPolicy;
  allowFrom?: Array<string | number>;
}

export interface ChannelSecurityContext {
  accountId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  isGroup: boolean;
  threadId?: string;
}

export interface ChannelSecurityAdapter<ResolvedAccount> {
  /** Resolve DM policy */
  resolveDmPolicy?(params: {
    account: ResolvedAccount;
    cfg: Config;
    senderId: string;
    chatId: string;
  }): DmPolicy;
  
  /** Resolve group policy */
  resolveGroupPolicy?(params: {
    account: ResolvedAccount;
    cfg: Config;
    groupId: string;
    senderId: string;
  }): GroupPolicy;
  
  /** Resolve AllowFrom */
  resolveAllowFrom?(params: {
    account: ResolvedAccount;
    cfg: Config;
    accountId?: string;
  }): Array<string | number> | undefined;
  
  /** Check access permission */
  checkAccess?(ctx: ChannelSecurityContext, account: ResolvedAccount, cfg: Config): {
    allowed: boolean;
    reason?: string;
  };
}

// ============================================
// Group Adapter
// ============================================

export interface ChannelGroupContext {
  accountId: string;
  groupId: string;
  channelId?: string;
  threadId?: string;
}

export interface ChannelGroupAdapter {
  /** Check if mention is required */
  resolveRequireMention?(params: ChannelGroupContext): boolean | undefined;
  
  /** Resolve group intro hint */
  resolveGroupIntroHint?(params: ChannelGroupContext): string | undefined;
  
  /** Resolve tool policy */
  resolveToolPolicy?(params: ChannelGroupContext): unknown; // GroupToolPolicyConfig
}

// ============================================
// Mention Adapter
// ============================================

export interface ChannelMentionAdapter {
  /** Check if bot is mentioned */
  hasMention?(params: {
    text: string;
    botUsername: string;
    entities?: unknown[];
  }): boolean;
  
  /** Remove bot mention */
  removeMention?(params: {
    text: string;
    botUsername: string;
  }): string;
}

// ============================================
// Status Adapter
// ============================================

export interface ChannelStatusAdapter<ResolvedAccount> {
  /** Default runtime snapshot */
  defaultRuntime?: ChannelAccountSnapshot;
  
  /** Build channel summary */
  buildChannelSummary?(params: {
    account: ResolvedAccount;
    cfg: Config;
    defaultAccountId: string;
    snapshot: ChannelAccountSnapshot;
  }): Record<string, unknown> | Promise<Record<string, unknown>>;
  
  /** Probe account */
  probeAccount?(params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: Config;
  }): Promise<unknown>;
  
  /** Audit account */
  auditAccount?(params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: Config;
    probe?: unknown;
  }): Promise<unknown>;
  
  /** Build account snapshot */
  buildAccountSnapshot?(params: {
    account: ResolvedAccount;
    cfg: Config;
    runtime?: ChannelAccountSnapshot;
    probe?: unknown;
    audit?: unknown;
  }): ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  
  /** Resolve account status */
  resolveAccountState?(params: {
    account: ResolvedAccount;
    cfg: Config;
    configured: boolean;
    enabled: boolean;
  }): 'online' | 'offline' | 'error' | 'disabled';
  
  /** Collect status issues */
  collectStatusIssues?(accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[];
}

export interface ChannelStatusIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  accountId?: string;
}

// ============================================
// Command Adapter
// ============================================

export interface ChannelCommandSpec {
  name: string;
  description: string;
  acceptsArgs?: boolean;
}

export interface ChannelCommandAdapter {
  /** List available commands */
  listCommands?(): ChannelCommandSpec[];
  
  /** Handle command */
  handleCommand?(params: {
    command: string;
    args: string[];
    context: unknown;
  }): Promise<unknown>;
}

// ============================================
// Message Action Adapter
// ============================================

export interface ChannelMessageActionContext {
  action: string;
  data: string;
  messageId: string;
  senderId: string;
  chatId: string;
  accountId: string;
}

export interface ChannelMessageActionAdapter {
  /** Handle action */
  handleAction?(ctx: ChannelMessageActionContext): Promise<void>;
}

// ============================================
// Gateway Adapter
// ============================================

export interface ChannelGatewayContext<ResolvedAccount = unknown> {
  cfg: Config;
  accountId: string;
  account: ResolvedAccount;
  abortSignal: AbortSignal;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface ChannelGatewayAdapter<ResolvedAccount> {
  methods?: string[];

  handle?(params: {
    method: string;
    params: Record<string, unknown>;
    context: ChannelGatewayContext<ResolvedAccount>;
  }): Promise<unknown>;

  startAccount?(ctx: ChannelGatewayContext<ResolvedAccount>): Promise<unknown>;

  stopAccount?(ctx: ChannelGatewayContext<ResolvedAccount>): Promise<void>;
}

// ============================================
// Agent Tools
// ============================================

export interface ChannelToolContext {
  accountId: string;
  chatId: string;
  senderId: string;
  messageId: string;
}

export interface ChannelAgentTool {
  name: string;
  description: string;
  execute(params: ChannelToolContext, args: unknown): Promise<unknown>;
}

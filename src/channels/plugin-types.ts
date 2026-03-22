/**
 * Channel Plugin Types - Core type definitions for channel plugins
 */

import type { Config } from '../config/index.js';
import type { MessageBus } from '../bus/index.js';

// ============================================
// Channel ID & Metadata
// ============================================

export type ChannelId = string;

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface ChannelCapabilities {
  chatTypes: ChatType[];
  reactions: boolean;
  threads: boolean;
  media: boolean;
  polls: boolean;
  nativeCommands: boolean;
  blockStreaming: boolean;
}

export interface ChannelMetadata {
  id: ChannelId;
  name: string;
  description: string;
  capabilities: ChannelCapabilities;
}

// ============================================
// Configuration Types
// ============================================

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'block';
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

export interface ChannelPluginInitOptions {
  bus: MessageBus;
  config: Config;
  channelConfig: Record<string, unknown>;
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
  /** Channel identifier */
  id: ChannelId;
  
  /** Channel metadata */
  meta: ChannelMetadata;

  /** Optional defaults (debounce, chunk limits); should match dock for built-in channels. */
  defaults?: ChannelPluginDefaults;

  /** Declares which config subtrees can be hot-applied (see plugin `onConfigUpdated`). */
  reload?: ChannelPluginReloadMeta;
  
  /** Initialize plugin (called once) */
  init(options: ChannelPluginInitOptions): Promise<void>;
  
  /** Start channel listener */
  start(options?: ChannelPluginStartOptions): Promise<void>;
  
  /** Stop channel */
  stop(accountId?: string): Promise<void>;

  /**
   * Whether this channel has at least one connected runtime (e.g. polling bot).
   * Used for gateway/UI status; omit if not applicable.
   */
  channelIsRunning?(cfg: Config): boolean;

  /**
   * Apply updated config after hot reload or gateway merge (optional).
   */
  onConfigUpdated?(cfg: Config): void | Promise<void>;

  /**
   * When true, `channels.<id>` may be absent; init/start run unless `channels.<id>.enabled === false`.
   * Used for extension-registered channels whose primary config lives under `extensions.*`.
   */
  extensionManagedConfig?: boolean;
  
  // Configuration adapter
  
  /** Configuration adapter - account management */
  configAdapter?: ChannelConfigAdapter<ResolvedAccount>;
  
  /** Configuration schema */
  configSchema?: ChannelConfigSchema;
  
  /** Setup adapter */
  setup?: ChannelSetupAdapter;
  
  // Outbound adapter
  
  /** Outbound message adapter */
  outbound?: ChannelOutboundAdapter;
  
  /** Streaming response adapter */
  streaming?: ChannelStreamingAdapter;
  
  // Security adapter
  
  /** Security adapter - access control */
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  
  /** Group policy adapter */
  groups?: ChannelGroupAdapter;
  
  /** Mention adapter */
  mentions?: ChannelMentionAdapter;
  
  // Status adapter
  
  /** Status adapter - health checks */
  status?: ChannelStatusAdapter<ResolvedAccount>;
  
  // Command adapter
  
  /** Command adapter */
  commands?: ChannelCommandAdapter;
  
  /** Message action adapter */
  actions?: ChannelMessageActionAdapter;
  
  // Gateway
  
  /** Gateway adapter */
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  
  // Tools
  
  /** Channel-specific Agent tools */
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
  /** Gateway method list */
  methods?: string[];
  
  /** Handle Gateway request */
  handle?(params: {
    method: string;
    params: Record<string, unknown>;
    context: ChannelGatewayContext<ResolvedAccount>;
  }): Promise<unknown>;
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

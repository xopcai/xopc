/**
 * Unified Command System - Core Types
 * 
 * Provides a platform-agnostic command system that works across
 * Telegram, Feishu, Web UI, CLI, and other channel surfaces.
 */

import type { Config } from '../config/schema.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  ThinkLevel,
  ReasoningLevel,
  VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import type { SessionConfigStore } from '../session/index.js';
import type {
  StartWorkflowRunServiceParams,
  WorkflowRunServiceLike,
  WorkflowRunServiceResult,
} from '../workflows/service/workflow-run-service.types.js';
import type { AgentSourceContext } from '../agent/source-context/types.js';

// ============================================================================
// Unified Message Format (Platform Agnostic)
// ============================================================================

export type MessageSource =
  | 'telegram'
  | 'weixin'
  | 'feishu'
  | 'webui'
  | 'cli'
  | 'api'
  | 'system'
  | 'gateway';

export interface UnifiedMessage {
  /** Message source platform */
  source: MessageSource;
  /** Channel identifier (e.g., 'telegram:default') */
  channelId: string;
  /** Platform-specific chat ID */
  chatId: string;
  /** Sender's platform-specific ID */
  senderId: string;
  /** Sender's display name */
  senderName?: string;
  /** Message content text */
  content: string;
  /** Whether this is a command (starts with / or :) */
  isCommand: boolean;
  /** Command name without prefix (e.g., 'new', 'usage') */
  commandName?: string;
  /** Command arguments */
  commandArgs?: string;
  /** Unified session key */
  sessionKey: string;
  /** Platform-specific metadata */
  platformData: PlatformMetadata;
  /** Optional attachments */
  attachments?: MessageAttachment[];
  /** Message timestamp */
  timestamp: number;
}

export interface PlatformMetadata {
  /** Platform message ID */
  messageId?: string;
  /** Thread/topic ID for forum-style chats */
  threadId?: string;
  /** Whether this is a group chat */
  isGroup: boolean;
  /** Whether this is a forum/topic */
  isForum?: boolean;
  /** Bot username (for mention detection) */
  botUsername?: string;
  /** Account ID for multi-account channels */
  accountId?: string;
  /** Raw platform-specific data (adapter use only) */
  raw?: unknown;
}

export interface MessageAttachment {
  type: 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
  mimeType?: string;
  data?: string; // base64
  url?: string;
  name?: string;
  size?: number;
  /** For voice messages: transcribed text */
  transcribedText?: string;
}

// ============================================================================
// Command System
// ============================================================================

export type CommandCategory = 'session' | 'model' | 'system' | 'tool' | 'extension';
export type CommandScope = 'global' | 'private' | 'group';

export interface CommandDefinition {
  /** Unique command identifier */
  id: string;
  /** Command name (without / prefix) */
  name: string;
  /** Alternative names/aliases */
  aliases?: string[];
  /** Human-readable description */
  description: string;
  /** Command category */
  category: CommandCategory;
  /** Where this command can be used */
  scope: CommandScope[];
  /** Whether command accepts arguments */
  acceptsArgs?: boolean;
  /** Whether command consumes frozen message-level source context. */
  acceptsContext?: boolean;
  /** Example usage */
  examples?: string[];
  /** Handler function */
  handler: CommandHandler;
}

export type CommandHandler = (
  context: CommandContext,
  args: string
) => Promise<CommandResult | void>;

export interface CompactSessionResult {
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
}

export interface CommandResult {
  /** Response text */
  content: string;
  /** Whether command succeeded */
  success?: boolean;
  /** Optional UI components */
  components?: UIComponent[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type CommandStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export type BtwQueryOptions = {
  maxTokens?: number;
  temperature?: number;
  modelRef?: string;
  /** Run as an isolated one-shot task instead of adding recent session history. */
  includeSessionContext?: boolean;
  /** Receives visible model text as it arrives for rich command surfaces. */
  onTextDelta?: (delta: string) => void | Promise<void>;
};

// ============================================================================
// Command Context (Platform Abstraction)
// ============================================================================

export interface CommandContext {
  // === Identity ===
  /** Unified session key */
  sessionKey: string;
  /** Message source platform */
  source: MessageSource;
  /** Channel ID */
  channelId: string;
  /** Chat ID */
  chatId: string;
  /** Sender ID */
  senderId: string;
  /** Whether this is a group context */
  isGroup: boolean;
  /** Account ID for multi-account channels, when supplied by routing metadata. */
  accountId?: string;
  /** Thread/topic ID for threaded channels, when supplied by routing metadata. */
  threadId?: string;
  
  // === Configuration ===
  /** Bot configuration */
  config: Config;
  sourceContexts?: AgentSourceContext[];
  
  // === Reply API ===
  /** Send a text reply */
  reply(text: string, options?: ReplyOptions): Promise<void>;
  /** Send a UI component */
  replyComponent(component: UIComponent): Promise<void>;
  /** Show typing indicator */
  setTyping(typing: boolean): Promise<void>;
  
  // === Session Management ===
  /** Get current session messages */
  getSession(): Promise<AgentMessage[]>;
  /** Clear current session (start fresh) */
  clearSession(): Promise<void>;
  /** Reset session in place (archive transcript, new session id; preserve overrides) */
  resetSession(): Promise<void>;
  /** Archive current session */
  archiveSession(): Promise<void>;
  /** List user's sessions */
  listSessions(): Promise<SessionInfo[]>;
  /** Switch to a different session */
  switchSession(sessionKey: string): Promise<void>;
  
  // === Model Management ===
  /** Get current model ID */
  getCurrentModel(): string;
  /** List available models */
  listModels(): Promise<ModelInfo[]>;
  /** Switch to a different model */
  switchModel(modelId: string): Promise<boolean>;
  /** Get token usage stats */
  getUsage(): Promise<UsageStats>;
  
  // === Platform Features ===
  /** Check if platform supports a feature */
  supports(feature: PlatformFeature): boolean;

  // === Configuration ===
  /** Get current configuration */
  getConfig?(): Config;
  /** Update configuration value */
  updateConfig?(path: string, value: unknown): Promise<boolean>;

  /** Reload skills from disk and refresh active agent prompts. */
  reloadSkills?(): Promise<void>;

  /** Install a managed skill from an explicit source and refresh active agent prompts. */
  installSkillFromSource?(opts: {
    source: string;
    ref?: string;
    path?: string;
    skillId?: string;
    target?: 'workspace' | 'global';
    force?: boolean;
    strictScan?: boolean;
  }): Promise<{
    skillId: string;
    path: string;
    source: string;
    kind: 'git' | 'archive';
    contentHash: string;
    target?: 'workspace' | 'global';
  }>;

  /** Persist session thinking level and sync in-memory agent (when wired) */
  setThinkingLevel?(level: ThinkLevel): Promise<void>;

  /**
   * Update pi-agent thinking level in memory only (used with runtime config overrides so session
   * store does not mask merged defaults).
   */
  syncAgentThinkingLevel?(level: ThinkLevel): void;

  getSessionConfigStore?(): SessionConfigStore | undefined;

  getThinkingLevel?(): Promise<ThinkLevel | undefined>;
  getReasoningLevel?(): Promise<ReasoningLevel | undefined>;
  getVerboseLevel?(): Promise<VerboseLevel | undefined>;

  /** Summarize older turns into a memory line; optional focus text for the summarizer. */
  compactSession?(options?: { instructions?: string; force?: boolean }): Promise<CompactSessionResult | null>;

  /** Side question: LLM answer without appending to the session transcript. */
  btwQuery?(question: string, options?: BtwQueryOptions): Promise<{ text: string; error?: string }>;

  /** Optional stream bridge for rich surfaces such as webchat/TUI. */
  emitEvent?(event: CommandStreamEvent): void | Promise<void>;

  /** Write session transcript to workspace `exports/` (markdown, html, or json). */
  exportSessionToWorkspace?(format: 'markdown' | 'html' | 'json'): Promise<{ path: string }>;

  /** Debug view: config + transcript stats (`list` | `detail` | `json`). */
  agentContextReport?(mode?: 'list' | 'detail' | 'json'): Promise<string>;

  /** Abort in-flight assistant generation and channel streaming for this session (e.g. /abort) */
  abortCurrentTurn?(): Promise<void>;

  workflowRunApis?: {
    startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult>;
    service: WorkflowRunServiceLike;
  };
}

export type PlatformFeature = 
  | 'buttons'      // Inline keyboards/buttons
  | 'markdown'     // Markdown formatting
  | 'html'         // HTML formatting
  | 'threads'      // Thread/topic support
  | 'reactions'    // Message reactions
  | 'edit'         // Message editing
  | 'delete'       // Message deletion
  | 'typing'       // Typing indicators
  | 'voice';       // Voice messages

export interface ReplyOptions {
  /** Parse mode */
  parseMode?: 'markdown' | 'html' | 'plain';
  /** Reply to message ID */
  replyTo?: string;
  /** Whether to show notification */
  silent?: boolean;
  /** Attach UI components */
  components?: UIComponent[];
}

// ============================================================================
// UI Components (Cross-Platform)
// ============================================================================

export type UIComponent =
  | ButtonGroup
  | SelectMenu
  | ModelPicker
  | UsageDisplay
  | SessionList
  | TextInput;

export interface ButtonGroup {
  type: 'buttons';
  buttons: Array<{
    id: string;
    text: string;
    style?: 'primary' | 'secondary' | 'danger';
  }>;
  layout?: 'horizontal' | 'vertical';
}

export interface SelectMenu {
  type: 'select';
  placeholder?: string;
  options: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
}

export interface ModelPicker {
  type: 'model-picker';
  providers: ProviderInfo[];
  currentModel?: string;
}

export interface UsageDisplay {
  type: 'usage-display';
  stats: UsageStats;
  modelName: string;
}

export interface SessionList {
  type: 'session-list';
  sessions: SessionInfo[];
  currentSession: string;
}

export interface TextInput {
  type: 'text-input';
  placeholder?: string;
  multiline?: boolean;
}

// ============================================================================
// Data Types
// ============================================================================

export interface ProviderInfo {
  id: string;
  name: string;
  icon?: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow?: number;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  messageCount: number;
}

export interface SessionInfo {
  key: string;
  name?: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

// ============================================================================
// Channel Adapter Interface
// ============================================================================

export interface ChannelAdapter {
  /** Adapter identifier */
  readonly id: MessageSource;
  /** Adapter display name */
  readonly name: string;
  /** Supported features */
  readonly features: PlatformFeature[];
  
  /** Initialize adapter */
  init(config: Config): Promise<void>;
  
  /** Start receiving messages */
  start(): Promise<void>;
  
  /** Stop receiving messages */
  stop(): Promise<void>;
  
  /** Convert platform message to unified format */
  normalizeMessage(platformMsg: unknown): Promise<UnifiedMessage | null>;
  
  /** Send a reply */
  sendReply(chatId: string, reply: ReplyPayload): Promise<void>;
  
  /** Set typing indicator */
  setTyping(chatId: string, typing: boolean): Promise<void>;
}

export interface ReplyPayload {
  text: string;
  parseMode?: 'markdown' | 'html' | 'plain';
  components?: UIComponent[];
  replyTo?: string;
  silent?: boolean;
}

// ============================================================================
// Command Registry
// ============================================================================

export interface CommandRegistry {
  /** Register a command */
  register(command: CommandDefinition): void;
  /** Unregister a command */
  unregister(commandId: string): void;
  /** Get command by name */
  get(name: string): CommandDefinition | undefined;
  /** Get all commands */
  list(): CommandDefinition[];
  /** Get commands by category */
  listByCategory(category: CommandCategory): CommandDefinition[];
  /** Check if command exists */
  has(name: string): boolean;
  /** Execute a command */
  execute(name: string, context: CommandContext, args: string): Promise<CommandResult>;
}

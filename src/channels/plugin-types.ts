/**
 * Channel Plugin Types - 频道插件核心类型定义
 * 
 * 参考 OpenClaw 架构设计，定义标准化的频道插件接口
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

export interface ChannelPlugin<ResolvedAccount = any> {
  /** 频道标识符 */
  id: ChannelId;
  
  /** 频道元数据 */
  meta: ChannelMetadata;
  
  /** 初始化插件 (仅调用一次) */
  init(options: ChannelPluginInitOptions): Promise<void>;
  
  /** 启动频道监听 */
  start(options?: ChannelPluginStartOptions): Promise<void>;
  
  /** 停止频道 */
  stop(accountId?: string): Promise<void>;
  
  // ---------- 配置适配器 ----------
  
  /** 配置适配器 - 账户管理 */
  config: ChannelConfigAdapter<ResolvedAccount>;
  
  /** 配置 Schema */
  configSchema?: ChannelConfigSchema;
  
  /** 设置适配器 */
  setup?: ChannelSetupAdapter;
  
  // ---------- 消息适配器 ----------
  
  /** 出站消息适配器 */
  outbound?: ChannelOutboundAdapter;
  
  /** 流式响应适配器 */
  streaming?: ChannelStreamingAdapter;
  
  // ---------- 安全适配器 ----------
  
  /** 安全适配器 - 访问控制 */
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  
  /** 群组策略适配器 */
  groups?: ChannelGroupAdapter;
  
  /** 提及适配器 */
  mentions?: ChannelMentionAdapter;
  
  // ---------- 状态适配器 ----------
  
  /** 状态适配器 - 健康检查 */
  status?: ChannelStatusAdapter<ResolvedAccount>;
  
  // ---------- 命令适配器 ----------
  
  /** 命令适配器 */
  commands?: ChannelCommandAdapter;
  
  /** 消息动作适配器 */
  actions?: ChannelMessageActionAdapter;
  
  // ---------- Gateway ----------
  
  /** Gateway 适配器 */
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  
  // ---------- 工具 ----------
  
  /** 频道特定的 Agent 工具 */
  agentTools?: ChannelAgentTool[];
}

// ============================================
// Config Adapter
// ============================================

export interface ChannelConfigAdapter<ResolvedAccount> {
  /** 列出所有账户 ID */
  listAccountIds(cfg: Config): string[];
  
  /** 解析账户配置 */
  resolveAccount(cfg: Config, accountId?: string | null): ResolvedAccount;
  
  /** 检查账户是否已配置 */
  isConfigured?(account: ResolvedAccount, cfg: Config): boolean | Promise<boolean>;
  
  /** 获取未配置原因 */
  unconfiguredReason?(account: ResolvedAccount, cfg: Config): string;
  
  /** 检查账户是否启用 */
  isEnabled?(account: ResolvedAccount, cfg: Config): boolean;
  
  /** 获取禁用原因 */
  disabledReason?(account: ResolvedAccount, cfg: Config): string;
  
  /** 描述账户状态 */
  describeAccount?(account: ResolvedAccount, cfg: Config): ChannelAccountSnapshot;
  
  /** 解析 AllowFrom 列表 */
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
  token?: string;
  botToken?: string;
  botTokenFile?: string;
  [key: string]: unknown;
}

// ============================================
// Outbound Adapter
// ============================================

export type ChannelOutboundTargetMode = 'default' | 'thread' | 'channel';

export interface ChannelOutboundContext {
  cfg: Config;
  to: string;
  text: string;
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  gifPlayback?: boolean;
  forceDocument?: boolean;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
  silent?: boolean;
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

export interface ChannelOutboundAdapter {
  /** 投递模式 */
  deliveryMode: 'direct' | 'gateway' | 'hybrid';
  
  /** 文本分块器 */
  chunker?: ((text: string, limit: number) => string[]) | null;
  
  /** 分块模式 */
  chunkerMode?: 'text' | 'markdown';
  
  /** 文本分块限制 */
  textChunkLimit?: number;
  
  /** 投票选项限制 */
  pollMaxOptions?: number;
  
  /** 解析目标 */
  resolveTarget?(params: {
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: ChannelOutboundTargetMode;
  }): { ok: true; to: string } | { ok: false; error: Error };
  
  /** 发送完整载荷 */
  sendPayload?(ctx: ChannelOutboundPayloadContext): Promise<OutboundDeliveryResult>;
  
  /** 发送文本 */
  sendText?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  
  /** 发送媒体 */
  sendMedia?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  
  /** 发送投票 */
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
  /** 开始流式消息 */
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
  /** 解析 DM 策略 */
  resolveDmPolicy?(params: {
    account: ResolvedAccount;
    cfg: Config;
    senderId: string;
    chatId: string;
  }): DmPolicy;
  
  /** 解析群组策略 */
  resolveGroupPolicy?(params: {
    account: ResolvedAccount;
    cfg: Config;
    groupId: string;
    senderId: string;
  }): GroupPolicy;
  
  /** 解析 AllowFrom */
  resolveAllowFrom?(params: {
    account: ResolvedAccount;
    cfg: Config;
    accountId?: string;
  }): Array<string | number> | undefined;
  
  /** 检查访问权限 */
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
  /** 是否需要提及 */
  resolveRequireMention?(params: ChannelGroupContext): boolean | undefined;
  
  /** 解析群组介绍提示 */
  resolveGroupIntroHint?(params: ChannelGroupContext): string | undefined;
  
  /** 解析工具策略 */
  resolveToolPolicy?(params: ChannelGroupContext): unknown; // GroupToolPolicyConfig
}

// ============================================
// Mention Adapter
// ============================================

export interface ChannelMentionAdapter {
  /** 检查是否提及 Bot */
  hasMention?(params: {
    text: string;
    botUsername: string;
    entities?: unknown[];
  }): boolean;
  
  /** 移除 Bot 提及 */
  removeMention?(params: {
    text: string;
    botUsername: string;
  }): string;
}

// ============================================
// Status Adapter
// ============================================

export interface ChannelStatusAdapter<ResolvedAccount> {
  /** 默认运行时快照 */
  defaultRuntime?: ChannelAccountSnapshot;
  
  /** 构建频道摘要 */
  buildChannelSummary?(params: {
    account: ResolvedAccount;
    cfg: Config;
    defaultAccountId: string;
    snapshot: ChannelAccountSnapshot;
  }): Record<string, unknown> | Promise<Record<string, unknown>>;
  
  /** 探测账户 */
  probeAccount?(params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: Config;
  }): Promise<unknown>;
  
  /** 审计账户 */
  auditAccount?(params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: Config;
    probe?: unknown;
  }): Promise<unknown>;
  
  /** 构建账户快照 */
  buildAccountSnapshot?(params: {
    account: ResolvedAccount;
    cfg: Config;
    runtime?: ChannelAccountSnapshot;
    probe?: unknown;
    audit?: unknown;
  }): ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  
  /** 解析账户状态 */
  resolveAccountState?(params: {
    account: ResolvedAccount;
    cfg: Config;
    configured: boolean;
    enabled: boolean;
  }): 'online' | 'offline' | 'error' | 'disabled';
  
  /** 收集状态问题 */
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
  /** 列出可用命令 */
  listCommands?(): ChannelCommandSpec[];
  
  /** 处理命令 */
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
  /** 处理动作 */
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
  /** Gateway 方法列表 */
  methods?: string[];
  
  /** 处理 Gateway 请求 */
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

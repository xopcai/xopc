/**
 * Command Context Implementation
 * 
 * Provides the concrete implementation of CommandContext interface,
 * bridging commands to core services (AgentService, SessionStore, etc.)
 */

import type {
  CommandContext,
  BtwQueryOptions,
  CommandStreamEvent,
  ReplyOptions,
  UIComponent,
  SessionInfo,
  ModelInfo,
  UsageStats,
  PlatformFeature,
  MessageSource,
  CompactSessionResult,
} from './types.js';
import { getSessionDisplayName } from './session-key.js';
import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionStore, SessionConfigStore } from '../session/index.js';
import { createLogger } from '../utils/logger.js';
import { saveConfig } from '../config/loader.js';
import type { ThinkLevel, ReasoningLevel, VerboseLevel } from '../agent/transcript/thinking-types.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { effectiveWorkspacePathForSession } from '../session/session-workspace.js';
import { wrapMarkdownExportAsHtml } from '../session/chat-export.js';
import type { CompactionResult } from '../agent/memory/compaction.js';
import type { WorkflowRunServiceLike } from '../workflows/service/workflow-run-service.types.js';
import { getProjectForSession } from '../projects/workspace.js';

const log = createLogger('CommandContext');

export interface CommandContextDeps {
  conversationId: string;
  source: MessageSource;
  channelId: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  accountId?: string;
  threadId?: string;
  config: Config;
  bus: MessageBus;
  sessionStore: SessionStore;
  sessionConfigStore?: SessionConfigStore;
  /** After persisting session thinking, sync pi-agent in-memory state */
  applySessionThinkingLevel?: (conversationId: string, level: ThinkLevel) => void;
  // Callbacks for platform-specific operations
  replyHandler: (text: string, options?: ReplyOptions) => Promise<void>;
  componentHandler?: (component: UIComponent) => Promise<void>;
  typingHandler?: (typing: boolean) => Promise<void>;
  supportedFeatures: PlatformFeature[];
  /** Called after session files are removed so in-memory agents match disk */
  invalidateAgentSession?: (conversationId: string) => void;
  /** Reset session in place (archive + new session id); optional — falls back to clearSession */
  resetSession?: (conversationId: string) => Promise<void>;
  // Model management (optional, will be injected)
  getCurrentModel?: () => string;
  switchModel?: (modelId: string) => Promise<boolean>;
  listModels?: () => Promise<ModelInfo[]>;
  getUsage?: () => Promise<UsageStats>;
  /** Stop current LLM turn and clear channel preview stream (Telegram draft, etc.) */
  abortCurrentTurn?: () => Promise<void>;
  /** Reload skills from disk and refresh active agent prompts. */
  reloadSkills?: () => Promise<void>;
  /** Install a managed skill from an explicit source and refresh active agent prompts. */
  installSkillFromSource?: CommandContext['installSkillFromSource'];

  compactSession?: (
    conversationId: string,
    options?: { instructions?: string; force?: boolean },
  ) => Promise<CompactionResult>;

  btwQuery?: (
    conversationId: string,
    question: string,
    options?: BtwQueryOptions,
  ) => Promise<{ text: string; error?: string }>;

  emitEvent?: (event: CommandStreamEvent) => void | Promise<void>;

  getSessionContextReport?: (
    conversationId: string,
    mode: 'list' | 'detail' | 'json',
  ) => Promise<string>;

  workflowRunService?: WorkflowRunServiceLike;
}

export class CommandContextImpl implements CommandContext {
  readonly conversationId: string;
  readonly source: MessageSource;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly isGroup: boolean;
  readonly accountId?: string;
  readonly threadId?: string;
  readonly config: Config;
  readonly abortCurrentTurn?: () => Promise<void>;
  readonly reloadSkills?: () => Promise<void>;
  readonly installSkillFromSource?: CommandContext['installSkillFromSource'];
  readonly workflowRunApis?: CommandContext['workflowRunApis'];

  private deps: CommandContextDeps;

  constructor(deps: CommandContextDeps) {
    this.conversationId = deps.conversationId;
    this.source = deps.source;
    this.channelId = deps.channelId;
    this.chatId = deps.chatId;
    this.senderId = deps.senderId;
    this.isGroup = deps.isGroup;
    this.accountId = deps.accountId;
    this.threadId = deps.threadId;
    this.config = deps.config;
    this.deps = deps;

    if (deps.abortCurrentTurn) {
      const run = deps.abortCurrentTurn;
      this.abortCurrentTurn = async () => {
        await run();
      };
    }

    if (deps.reloadSkills) {
      const run = deps.reloadSkills;
      this.reloadSkills = async () => {
        await run();
      };
    }

    if (deps.installSkillFromSource) {
      this.installSkillFromSource = deps.installSkillFromSource;
    }

    if (deps.workflowRunService) {
      this.workflowRunApis = {
        service: deps.workflowRunService,
        startWorkflowRun: (params) => deps.workflowRunService!.startWorkflowRun(params),
      };
    }
  }

  private outboundMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      accountId: this.deps.accountId,
      threadId: this.deps.threadId,
      ...extra,
    };
  }

  // === Reply API ===

  async reply(text: string, options?: ReplyOptions): Promise<void> {
    await this.deps.replyHandler(text, options);
  }

  async replyComponent(component: UIComponent): Promise<void> {
    if (this.deps.componentHandler) {
      await this.deps.componentHandler(component);
    } else {
      // Fallback to text representation
      await this.reply(this.renderComponentAsText(component));
    }
  }

  async setTyping(typing: boolean): Promise<void> {
    if (this.deps.typingHandler) {
      await this.deps.typingHandler(typing);
    }
  }

  // === Session Management ===

  async getSession(): Promise<AgentMessage[]> {
    return this.deps.sessionStore.load(this.conversationId);
  }

  async resetSession(): Promise<void> {
    if (this.deps.resetSession) {
      await this.deps.resetSession(this.conversationId);
    } else if (typeof this.deps.sessionStore.reset === 'function') {
      const task = await this.deps.sessionStore.reset(this.conversationId);
      if (!task) {
        throw new Error('Session not found');
      }
      this.deps.invalidateAgentSession?.(this.conversationId);
    } else {
      await this.clearSession();
      return;
    }

    log.info({ conversationId: this.conversationId }, 'Session reset');
  }

  async clearSession(): Promise<void> {
    // Archive first if has messages
    const messages = await this.getSession();
    if (messages.length > 0) {
      await this.deps.sessionStore.archive(this.conversationId);
      log.info({ conversationId: this.conversationId, messageCount: messages.length }, 'Session archived');
    }

    // Delete session
    await this.deps.sessionStore.deleteSession(this.conversationId);
    this.deps.invalidateAgentSession?.(this.conversationId);

    // Publish outbound message to confirm
    await this.deps.bus.publishOutbound({
      channel: this.source,
      chat_id: this.chatId,
      content: '✅ Session cleared.',
      type: 'message',
      metadata: this.outboundMetadata(),
    });

    log.info({ conversationId: this.conversationId }, 'Session cleared');
  }

  async archiveSession(): Promise<void> {
    await this.deps.sessionStore.archive(this.conversationId);
    log.info({ conversationId: this.conversationId }, 'Session archived');
  }

  async listSessions(): Promise<SessionInfo[]> {
    const { items } = await this.deps.sessionStore.list({
      channel: this.channelId,
      limit: 100,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    return items
      .filter((item) => {
        if (this.channelId === 'webchat') return true;
        const routing = item.routing;
        if (!routing) return item.key === this.conversationId;
        return routing.peerId === this.chatId
          && (!this.accountId || routing.accountId === this.accountId)
          && (!this.threadId || routing.threadId === this.threadId);
      })
      .map((item) => ({
        key: item.key,
        name: item.name ?? getSessionDisplayName(item.key),
        messageCount: item.messageCount,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        isActive: item.key === this.conversationId,
      }));
  }

  async switchSession(conversationId: string): Promise<void> {
    // This is mainly for CLI/Web UI where you can switch between sessions
    // For Telegram, each chat has its own session
    log.info({ from: this.conversationId, to: conversationId }, 'Session switch requested');
    
    // Note: In the current architecture, switching session means
    // the next message will use a different conversationId
    // The actual switch happens at the adapter level
  }

  // === Model Management ===

  getCurrentModel(): string {
    if (this.deps.getCurrentModel) {
      return this.deps.getCurrentModel();
    }
    
    return getAgentDefaultModelRef();
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.deps.listModels) {
      return this.deps.listModels();
    }
    
    // Fallback to empty list
    return [];
  }

  async switchModel(modelId: string): Promise<boolean> {
    if (this.deps.switchModel) {
      return this.deps.switchModel(modelId);
    }
    
    // No model manager available
    await this.reply('❌ Model switching not available in this context.');
    return false;
  }

  async getUsage(): Promise<UsageStats> {
    if (this.deps.getUsage) {
      return this.deps.getUsage();
    }
    
    // Fallback: calculate from session
    const messages = await this.getSession();
    let promptTokens = 0;
    let completionTokens = 0;
    
    for (const msg of messages) {
      if ('usage' in msg && msg.usage) {
        promptTokens += msg.usage.input || 0;
        completionTokens += msg.usage.output || 0;
      }
    }
    
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      messageCount: messages.length,
    };
  }

  // === Platform Features ===

  supports(feature: PlatformFeature): boolean {
    return this.deps.supportedFeatures.includes(feature);
  }

  // === Configuration ===

  getConfig(): Config {
    return this.config;
  }

  async updateConfig(path: string, value: unknown): Promise<boolean> {
    try {
      // Update config object using path
      const keys = path.split('.');
      let target: Record<string, unknown> = this.config as Record<string, unknown>;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
          target[key] = {};
        }
        target = target[key] as Record<string, unknown>;
      }
      
      target[keys[keys.length - 1]] = value;
      
      // Save to disk
      await saveConfig(this.config);
      
      log.info({ path, value }, 'Config updated via command');
      return true;
    } catch (error) {
      log.error({ err: error, path, value }, 'Failed to update config');
      return false;
    }
  }

  // === Private Helpers ===

  // === Thinking Configuration ===

  /**
   * Get the session config store (if available)
   */
  getSessionConfigStore(): SessionConfigStore | undefined {
    return this.deps.sessionConfigStore;
  }

  /**
   * Get current thinking level (session override or default)
   */
  async getThinkingLevel(): Promise<ThinkLevel | undefined> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      const sessionConfig = await configStore.get(this.conversationId);
      if (sessionConfig?.thinkingLevel) {
        return sessionConfig.thinkingLevel;
      }
    }
    return undefined;
  }

  /**
   * Set thinking level for this session
   */
  async setThinkingLevel(level: ThinkLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.conversationId, { thinkingLevel: level });
    }
    this.deps.applySessionThinkingLevel?.(this.conversationId, level);
  }

  syncAgentThinkingLevel(level: ThinkLevel): void {
    this.deps.applySessionThinkingLevel?.(this.conversationId, level);
  }

  async compactSession(options?: { instructions?: string; force?: boolean }): Promise<CompactSessionResult | null> {
    if (!this.deps.compactSession) {
      return null;
    }
    const r = await this.deps.compactSession(this.conversationId, options);
    return {
      compacted: r.compacted,
      tokensBefore: r.tokensBefore,
      tokensAfter: r.tokensAfter,
      summary: r.summary,
    };
  }

  async btwQuery(question: string, options?: BtwQueryOptions): Promise<{ text: string; error?: string }> {
    if (!this.deps.btwQuery) {
      return { text: '', error: 'Side questions are not available in this environment.' };
    }
    return this.deps.btwQuery(this.conversationId, question, options);
  }

  emitEvent(event: CommandStreamEvent): void | Promise<void> {
    return this.deps.emitEvent?.(event);
  }

  async exportSessionToWorkspace(format: 'markdown' | 'html' | 'json'): Promise<{ path: string }> {
    const exportFmt = format === 'json' ? 'json' : 'markdown';
    let body = await this.deps.sessionStore.exportSession(this.conversationId, exportFmt);
    if (format === 'html') {
      body = wrapMarkdownExportAsHtml(`Session ${this.conversationId}`, body);
    }
    const sc = this.deps.sessionConfigStore
      ? await this.deps.sessionConfigStore.get(this.conversationId)
      : null;
    const root = effectiveWorkspacePathForSession(
      this.config,
      this.conversationId,
      sc,
      getProjectForSession(this.conversationId),
    );
    const dir = join(root, 'exports');
    await mkdir(dir, { recursive: true });
    const safe = this.conversationId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96);
    const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md';
    const name = `session-${safe}-${Date.now()}.${ext}`;
    const outPath = join(dir, name);
    await writeFile(outPath, body, 'utf-8');
    return { path: outPath };
  }

  async agentContextReport(mode: 'list' | 'detail' | 'json' = 'list'): Promise<string> {
    if (!this.deps.getSessionContextReport) {
      return 'Context report is not available in this environment.';
    }
    return this.deps.getSessionContextReport(this.conversationId, mode);
  }

  /**
   * Get current reasoning level (session override or default)
   */
  async getReasoningLevel(): Promise<ReasoningLevel | undefined> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      const sessionConfig = await configStore.get(this.conversationId);
      if (sessionConfig?.reasoningLevel) {
        return sessionConfig.reasoningLevel;
      }
    }
    return undefined;
  }

  /**
   * Set reasoning level for this session
   */
  async setReasoningLevel(level: ReasoningLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.conversationId, { reasoningLevel: level });
    }
  }

  /**
   * Get current verbose level (session override or default)
   */
  async getVerboseLevel(): Promise<VerboseLevel | undefined> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      const sessionConfig = await configStore.get(this.conversationId);
      if (sessionConfig?.verboseLevel) {
        return sessionConfig.verboseLevel;
      }
    }
    return undefined;
  }

  /**
   * Set verbose level for this session
   */
  async setVerboseLevel(level: VerboseLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.conversationId, { verboseLevel: level });
    }
  }

  private renderComponentAsText(component: UIComponent): string {
    switch (component.type) {
      case 'buttons':
        return component.buttons.map(b => `[${b.text}]`).join(' ');
      
      case 'select':
        return component.options.map(o => `- ${o.label}`).join('\n');
      
      case 'model-picker':
        return component.providers.map(p => 
          `**${p.name}**\n${p.models.map(m => `  - ${m.name}`).join('\n')}`
        ).join('\n\n');
      
      case 'usage-display':
        return `📊 Usage Stats:\n` +
          `📥 Prompt: ${component.stats.promptTokens.toLocaleString()} tokens\n` +
          `📤 Completion: ${component.stats.completionTokens.toLocaleString()} tokens\n` +
          `📊 Total: ${component.stats.totalTokens.toLocaleString()} tokens`;
      
      case 'session-list':
        return component.sessions.map(s => 
          `${s.isActive ? '▶️' : '  '} ${s.key} (${s.messageCount} messages)`
        ).join('\n');
      
      case 'text-input':
        return component.placeholder || 'Enter text...';
      
      default:
        return '[UI Component]';
    }
  }
}

/**
 * Create a command context from dependencies
 */
export function createCommandContext(deps: CommandContextDeps): CommandContext {
  return new CommandContextImpl(deps);
}

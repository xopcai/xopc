/**
 * Command Context Implementation
 * 
 * Provides the concrete implementation of CommandContext interface,
 * bridging commands to core services (AgentService, SessionStore, etc.)
 */

import type {
  CommandContext,
  ReplyOptions,
  UIComponent,
  SessionInfo,
  ModelInfo,
  UsageStats,
  PlatformFeature,
  MessageSource,
} from './types.js';
import { getSessionDisplayName } from './session-key.js';
import type { Config } from '../config/schema.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { MessageBus } from '../bus/index.js';
import type { SessionStore, SessionConfigStore } from '../session/index.js';
import { createLogger } from '../utils/logger.js';
import { getRoutingInfo } from './session-key.js';
import { saveConfig } from '../config/loader.js';
import type { ThinkLevel, ReasoningLevel, VerboseLevel } from '../types/thinking.js';

const log = createLogger('CommandContext');

export interface CommandContextDeps {
  sessionKey: string;
  source: MessageSource;
  channelId: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  config: Config;
  bus: MessageBus;
  sessionStore: SessionStore;
  sessionConfigStore?: SessionConfigStore;
  // Callbacks for platform-specific operations
  replyHandler: (text: string, options?: ReplyOptions) => Promise<void>;
  componentHandler?: (component: UIComponent) => Promise<void>;
  typingHandler?: (typing: boolean) => Promise<void>;
  supportedFeatures: PlatformFeature[];
  /** Called after session files are removed so in-memory agents match disk */
  invalidateAgentSession?: (sessionKey: string) => void;
  // Model management (optional, will be injected)
  getCurrentModel?: () => string;
  switchModel?: (modelId: string) => Promise<boolean>;
  listModels?: () => Promise<ModelInfo[]>;
  getUsage?: () => Promise<UsageStats>;
}

export class CommandContextImpl implements CommandContext {
  readonly sessionKey: string;
  readonly source: MessageSource;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly isGroup: boolean;
  readonly config: Config;

  private deps: CommandContextDeps;

  constructor(deps: CommandContextDeps) {
    this.sessionKey = deps.sessionKey;
    this.source = deps.source;
    this.channelId = deps.channelId;
    this.chatId = deps.chatId;
    this.senderId = deps.senderId;
    this.isGroup = deps.isGroup;
    this.config = deps.config;
    this.deps = deps;
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
    return this.deps.sessionStore.load(this.sessionKey);
  }

  async clearSession(): Promise<void> {
    // Archive first if has messages
    const messages = await this.getSession();
    if (messages.length > 0) {
      await this.deps.sessionStore.archive(this.sessionKey);
      log.info({ sessionKey: this.sessionKey, messageCount: messages.length }, 'Session archived');
    }

    // Delete session
    await this.deps.sessionStore.deleteSession(this.sessionKey);
    this.deps.invalidateAgentSession?.(this.sessionKey);

    // Publish outbound message to confirm
    const routing = getRoutingInfo(this.sessionKey);
    await this.deps.bus.publishOutbound({
      channel: routing.channel,
      chat_id: routing.chatId,
      content: '✅ New session started. Previous session has been archived.',
      type: 'message',
      metadata: {
        threadId: routing.threadId,
      },
    });

    log.info({ sessionKey: this.sessionKey }, 'Session cleared');
  }

  async archiveSession(): Promise<void> {
    await this.deps.sessionStore.archive(this.sessionKey);
    log.info({ sessionKey: this.sessionKey }, 'Session archived');
  }

  async listSessions(): Promise<SessionInfo[]> {
    // TODO: Implement listSessions in SessionStore
    // For now, return current session only
    const messages = await this.getSession();
    return [{
      key: this.sessionKey,
      name: getSessionDisplayName(this.sessionKey),
      messageCount: messages.length,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
    }];
  }

  async switchSession(sessionKey: string): Promise<void> {
    // This is mainly for CLI/Web UI where you can switch between sessions
    // For Telegram, each chat has its own session
    log.info({ from: this.sessionKey, to: sessionKey }, 'Session switch requested');
    
    // Note: In the current architecture, switching session means
    // the next message will use a different sessionKey
    // The actual switch happens at the adapter level
  }

  // === Model Management ===

  getCurrentModel(): string {
    if (this.deps.getCurrentModel) {
      return this.deps.getCurrentModel();
    }
    
    // Fallback to config default
    const modelConfig = this.config.agents?.defaults?.model;
    return typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary || 'minimax/minimax-m2.1';
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
      const sessionConfig = await configStore.get(this.sessionKey);
      if (sessionConfig?.thinkingLevel) {
        return sessionConfig.thinkingLevel;
      }
    }
    // Fallback to agent default
    return this.config.agents?.defaults?.thinkingDefault;
  }

  /**
   * Set thinking level for this session
   */
  async setThinkingLevel(level: ThinkLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.sessionKey, { thinkingLevel: level });
    }
  }

  /**
   * Get current reasoning level (session override or default)
   */
  async getReasoningLevel(): Promise<ReasoningLevel | undefined> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      const sessionConfig = await configStore.get(this.sessionKey);
      if (sessionConfig?.reasoningLevel) {
        return sessionConfig.reasoningLevel;
      }
    }
    // Fallback to agent default
    return this.config.agents?.defaults?.reasoningDefault;
  }

  /**
   * Set reasoning level for this session
   */
  async setReasoningLevel(level: ReasoningLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.sessionKey, { reasoningLevel: level });
    }
  }

  /**
   * Get current verbose level (session override or default)
   */
  async getVerboseLevel(): Promise<VerboseLevel | undefined> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      const sessionConfig = await configStore.get(this.sessionKey);
      if (sessionConfig?.verboseLevel) {
        return sessionConfig.verboseLevel;
      }
    }
    // Fallback to agent default
    return this.config.agents?.defaults?.verboseDefault;
  }

  /**
   * Set verbose level for this session
   */
  async setVerboseLevel(level: VerboseLevel): Promise<void> {
    const configStore = this.deps.sessionConfigStore;
    if (configStore) {
      await configStore.update(this.sessionKey, { verboseLevel: level });
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

/**
 * Agent Manager - Manages Agent instances per session
 *
 * Each session gets its own Agent instance for true isolation
 * and concurrent processing across sessions.
 * 
 * Simplified implementation following KISS and DRY principles.
 */

import { Agent, type AgentMessage, type AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { resolveModel, getDefaultModel, getApiKey as getProviderApiKey } from '../providers/index.js';
import { getBundledSkillsDir } from '../config/paths.js';
import { loadBootstrapFiles, extractTextContent } from './helpers.js';
import { SkillManager } from './skills/index.js';
import { SystemPromptBuilder } from './prompt/service-prompt-builder.js';
import { AgentToolsFactory } from './agent-tools-factory.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { MessageBus } from '../bus/index.js';
import type { SessionContext } from './session/session-context.js';

const log = createLogger('AgentManager');

export interface AgentManagerConfig {
  workspace: string;
  model?: string;
  config?: Config;
  braveApiKey?: string;
  extensionRegistry?: ExtensionRegistry;
  bus: MessageBus;
  getCurrentContext: () => SessionContext | null;
}

/**
 * Agent instance wrapper
 */
interface AgentInstance {
  agent: Agent;
  sessionKey: string;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Simplified Agent Manager
 * 
 * Only manages Agent instance lifecycle per session.
 * All Agent configuration is done at creation time.
 */
export class AgentManager {
  private agents = new Map<string, AgentInstance>();
  private config: AgentManagerConfig;
  private toolsFactory: AgentToolsFactory;
  private systemPromptBuilder: SystemPromptBuilder;
  private defaultModel: string;
  private bootstrapFiles: ReturnType<typeof loadBootstrapFiles>;

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.bootstrapFiles = loadBootstrapFiles(config.workspace);
    
    const skillManager = new SkillManager(config.workspace, getBundledSkillsDir());
    this.systemPromptBuilder = new SystemPromptBuilder({
      workspace: config.workspace,
      config: config.config!,
      skillManager,
    });
    
    this.toolsFactory = new AgentToolsFactory({
      workspace: config.workspace,
      braveApiKey: config.braveApiKey,
      extensionRegistry: config.extensionRegistry,
      getCurrentContext: config.getCurrentContext,
      bus: config.bus,
    });
    
    this.defaultModel = config.model || getDefaultModel(config.config);
  }

  /**
   * Get or create an Agent instance for a session
   */
  getOrCreateAgent(sessionKey: string): Agent {
    const existing = this.agents.get(sessionKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.agent;
    }

    const agent = this.createAgent();
    this.agents.set(sessionKey, {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    log.debug({ sessionKey, count: this.agents.size }, 'Agent instance created');
    return agent;
  }

  /**
   * Get existing agent for a session
   */
  getAgent(sessionKey: string): Agent | undefined {
    return this.agents.get(sessionKey)?.agent;
  }

  /**
   * Set model for a specific session
   */
  setModelForSession(sessionKey: string, modelId: string): boolean {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      return false;
    }

    try {
      const model = resolveModel(modelId);
      instance.agent.setModel(model);
      return true;
    } catch (err) {
      log.error({ err, sessionKey, modelId }, 'Failed to set model');
      return false;
    }
  }

  /**
   * Get last assistant content from a session's agent
   */
  getLastAssistantContent(sessionKey: string): string | null {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      return null;
    }

    const messages = instance.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const content = msg.content;
        if (Array.isArray(content)) {
          return extractTextContent(content as Array<{ type: string; text?: string }>);
        }
        return String(content);
      }
    }
    return null;
  }

  /**
   * Get messages from a session's agent
   */
  getMessages(sessionKey: string): AgentMessage[] | null {
    return this.agents.get(sessionKey)?.agent.state.messages ?? null;
  }

  /**
   * Subscribe to agent events for a session
   */
  subscribeToSession(sessionKey: string, callback: (event: AgentEvent) => void): (() => void) | null {
    const instance = this.agents.get(sessionKey);
    return instance?.agent.subscribe(callback) ?? null;
  }

  /**
   * Dispose all agents
   */
  dispose(): void {
    for (const instance of this.agents.values()) {
      instance.agent.abort();
    }
    this.agents.clear();
    log.info('All agent instances disposed');
  }

  /**
   * Create a new Agent instance
   */
  private createAgent(): Agent {
    const tools = this.toolsFactory.createAllTools();
    const model = this.resolveModel();

    return new Agent({
      initialState: {
        systemPrompt: this.systemPromptBuilder.build(this.bootstrapFiles),
        model,
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => getProviderApiKey(this.config.config, provider),
    });
  }

  /**
   * Resolve model
   */
  private resolveModel(): Model<Api> {
    if (this.config.model) {
      try {
        return resolveModel(this.config.model);
      } catch {
        return resolveModel(getDefaultModel(this.config.config));
      }
    }
    return resolveModel(getDefaultModel(this.config.config));
  }
}

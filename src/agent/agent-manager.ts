/**
 * Agent Manager - Manages Agent instances per session
 *
 * Each session gets its own Agent instance for true isolation
 * and concurrent processing across sessions.
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

export interface AgentInstance {
  agent: Agent;
  sessionKey: string;
  createdAt: number;
  lastUsedAt: number;
}

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  private config: AgentManagerConfig;
  private skillManager: SkillManager;
  private systemPromptBuilder: SystemPromptBuilder;
  private toolsFactory: AgentToolsFactory;
  private defaultModel: string;
  private bootstrapFiles: ReturnType<typeof loadBootstrapFiles>;

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.bootstrapFiles = loadBootstrapFiles(config.workspace);
    this.skillManager = new SkillManager(config.workspace, getBundledSkillsDir());
    this.systemPromptBuilder = new SystemPromptBuilder({
      workspace: config.workspace,
      config: config.config!,
      skillManager: this.skillManager,
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
      log.debug({ sessionKey }, 'Reusing existing agent instance');
      return existing.agent;
    }

    // Create new agent instance
    const agent = this.createAgent();
    const instance: AgentInstance = {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.agents.set(sessionKey, instance);
    log.info({ sessionKey, totalAgents: this.agents.size }, 'Created new agent instance');

    return agent;
  }

  /**
   * Get existing agent for a session (if any)
   */
  getAgent(sessionKey: string): Agent | undefined {
    return this.agents.get(sessionKey)?.agent;
  }

  /**
   * Check if an agent exists for a session
   */
  hasAgent(sessionKey: string): boolean {
    return this.agents.has(sessionKey);
  }

  /**
   * Remove an agent instance
   */
  removeAgent(sessionKey: string): boolean {
    const instance = this.agents.get(sessionKey);
    if (instance) {
      // Abort any ongoing operations
      instance.agent.abort();
      this.agents.delete(sessionKey);
      log.info({ sessionKey, totalAgents: this.agents.size }, 'Removed agent instance');
      return true;
    }
    return false;
  }

  /**
   * Get all active session keys
   */
  getActiveSessions(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Clean up idle agents (optional, for memory management)
   */
  cleanupIdleAgents(maxIdleMs: number): number {
    const now = Date.now();
    let removed = 0;

    for (const [sessionKey, instance] of this.agents.entries()) {
      const idleTime = now - instance.lastUsedAt;
      if (idleTime > maxIdleMs) {
        // Only remove if agent is not busy
        if (!instance.agent.state.isStreaming) {
          instance.agent.abort();
          this.agents.delete(sessionKey);
          removed++;
          log.info({ sessionKey, idleTime }, 'Cleaned up idle agent');
        }
      }
    }

    if (removed > 0) {
      log.info({ removed, remaining: this.agents.size }, 'Agent cleanup complete');
    }

    return removed;
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
      getApiKey: (provider: string) => {
        return getProviderApiKey(this.config.config, provider);
      },
    });
  }

  /**
   * Resolve model for agent
   */
  private resolveModel(): Model<Api> {
    if (this.config.model) {
      try {
        return resolveModel(this.config.model);
      } catch {
        const defaultModel = getDefaultModel(this.config.config);
        log.warn({ model: this.config.model, defaultModel }, 'Model not found, using default');
        return resolveModel(defaultModel);
      }
    }
    return resolveModel(getDefaultModel(this.config.config));
  }

  /**
   * Set model for a specific session
   */
  setModelForSession(sessionKey: string, modelId: string): boolean {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      log.warn({ sessionKey }, 'Cannot set model: agent instance not found');
      return false;
    }

    try {
      const model = resolveModel(modelId);
      instance.agent.setModel(model);
      log.info({ sessionKey, modelId }, 'Model set for session');
      return true;
    } catch (err) {
      log.error({ err, sessionKey, modelId }, 'Failed to set model for session');
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
   * Replace messages for a session's agent
   */
  replaceMessages(sessionKey: string, messages: AgentMessage[]): boolean {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      return false;
    }

    instance.agent.replaceMessages(messages);
    return true;
  }

  /**
   * Get messages for a session's agent
   */
  getMessages(sessionKey: string): AgentMessage[] | null {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      return null;
    }

    return instance.agent.state.messages;
  }

  /**
   * Subscribe to agent events for a session
   */
  subscribeToSession(sessionKey: string, callback: (event: AgentEvent) => void): (() => void) | null {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      return null;
    }

    return instance.agent.subscribe(callback);
  }
}

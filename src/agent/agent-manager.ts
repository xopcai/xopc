/**
 * Agent Manager - Manages Agent instances per session
 *
 * Each session gets its own Agent instance for true isolation
 * and concurrent processing across sessions.
 */

import { Agent, type AgentMessage, type AgentEvent, type ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { resolveModel, getDefaultModelSync, getApiKeySync } from '../providers/index.js';
import { CredentialResolver } from '../auth/credentials.js';
import { resolveBundledSkillsDir, resolveStateDir } from '../config/paths.js';
import { loadBootstrapFiles, extractTextContent } from './context/helpers.js';
import { SkillManager } from './skills/index.js';
import { SystemPromptBuilder } from './prompt/service-prompt-builder.js';
import { AgentToolsFactory } from './tools/factory.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionContext } from './session/session-context.js';
import type { Skill } from './skills/types.js';
import { createSkillConfigManager } from './skills/config.js';
import { isUnderManagedSkillsDir } from './skills/managed-store.js';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const log = createLogger('AgentManager');

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: Skill['source'];
  path: string;
  managed: boolean;
  /** User toggle in ~/.xopcbot/skills.json (`entries[name].enabled`). Default true. */
  enabled: boolean;
  /** When true, skill is never injected into `<available_skills>` (SKILL.md frontmatter). */
  disableModelInvocation: boolean;
}

export interface AgentManagerConfig {
  workspace: string;
  model?: string;
  config?: Config;
  extensionRegistry?: ExtensionRegistry;
  bus: MessageBus;
  getCurrentContext: () => SessionContext | null;
  // Thinking configuration
  thinkingLevel?: ThinkingLevel;
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseLevel?: 'off' | 'on' | 'full';
}

export interface AgentInstance {
  agent: Agent;
  sessionKey: string;
  createdAt: number;
  lastUsedAt: number;
}

export class AgentManager {
  private agents = new Map<string, AgentInstance>();
  private config: AgentManagerConfig;
  private toolsFactory: AgentToolsFactory;
  private systemPromptBuilder: SystemPromptBuilder;
  private skillManager: SkillManager;
  private defaultModel: string;
  private bootstrapFiles: ReturnType<typeof loadBootstrapFiles>;
  private credentialCache = new Map<string, string>();
  private credentialResolver: CredentialResolver;

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.bootstrapFiles = loadBootstrapFiles(config.workspace);

    this.skillManager = new SkillManager(config.workspace, resolveBundledSkillsDir());
    this.systemPromptBuilder = new SystemPromptBuilder({
      workspace: config.workspace,
      config: config.config!,
      skillManager: this.skillManager,
    });

    this.toolsFactory = new AgentToolsFactory({
      workspace: config.workspace,
      extensionRegistry: config.extensionRegistry,
      getCurrentContext: config.getCurrentContext,
      bus: config.bus,
      getConfig: () => this.config.config,
      getPrimaryModel: () => this.resolveModel(),
    });

    this.defaultModel = config.model || getDefaultModelSync(config.config);

    this.credentialResolver = new CredentialResolver();
    this.warmCredentialCache().catch((err) => {
      log.warn({ err }, 'Failed to pre-warm credential cache');
    });
  }

  /**
   * Keep defaults in sync when config is hot-reloaded or saved from the UI.
   */
  updateAgentDefaults(config: Config): void {
    this.config.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.config.model = ref;
    this.defaultModel = ref || getDefaultModelSync(config);
  }

  /**
   * Skills currently loaded (merged). `managed` means the skill directory is under ~/.xopcbot/skills.
   */
  /**
   * Read raw SKILL.md from disk (including frontmatter) for UI preview.
   */
  getSkillMarkdownSource(skillName: string): { name: string; markdown: string } | null {
    const skill = this.skillManager.findSkill(skillName);
    if (!skill) return null;
    try {
      const markdown = readFileSync(skill.filePath, 'utf-8');
      return { name: skill.name, markdown };
    } catch (err) {
      log.warn({ err, skillName, path: skill.filePath }, 'Failed to read SKILL.md');
      return null;
    }
  }

  getSkillCatalog(): SkillCatalogEntry[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    return this.skillManager.getSkills().map((s) => {
      const base = resolve(s.baseDir);
      const managed = isUnderManagedSkillsDir(s.baseDir);
      const directoryId = base.split(sep).filter(Boolean).pop() || s.name;
      const enabled = !(skillsConfig.entries?.[s.name]?.enabled === false);
      return {
        directoryId,
        name: s.name,
        description: s.description,
        source: s.source,
        path: s.baseDir,
        managed,
        enabled,
        disableModelInvocation: s.disableModelInvocation,
      };
    });
  }

  /**
   * After ~/.xopcbot/skills.json changes (enable/disable), refresh `<available_skills>` on active agents.
   */
  refreshSkillsAfterSkillConfigChange(): void {
    this.skillManager.refreshPromptFromConfig();
    const newPrompt = this.systemPromptBuilder.build(this.bootstrapFiles);
    for (const instance of this.agents.values()) {
      instance.agent.setSystemPrompt(newPrompt);
    }
    log.info({ agents: this.agents.size }, 'Skill toggles applied; system prompt updated');
  }

  /**
   * Reload skills from disk and refresh system prompt on all active Agent instances.
   */
  refreshSkillsAfterDiskChange(): void {
    const newPrompt = this.systemPromptBuilder.rebuild(this.bootstrapFiles);
    for (const instance of this.agents.values()) {
      instance.agent.setSystemPrompt(newPrompt);
    }
    log.info({ agents: this.agents.size }, 'Skills refreshed; system prompt updated');
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

    const agent = this.createAgent();
    this.agents.set(sessionKey, {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    log.debug({ sessionKey, totalAgents: this.agents.size }, 'Created new agent instance');
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
   * Set thinking level for a session's agent
   */
  setThinkingLevel(sessionKey: string, level: ThinkingLevel): void {
    const instance = this.agents.get(sessionKey);
    if (instance) {
      instance.agent.setThinkingLevel(level);
      log.debug({ sessionKey, thinkingLevel: level }, 'Set thinking level for agent');
    }
  }

  /**
   * Dispose all agents
   */
  dispose(): void {
    for (const instance of this.agents.values()) {
      instance.agent.abort();
    }
    this.agents.clear();
    log.debug('All agent instances disposed');
  }

  async warmCredentialCache(): Promise<void> {
    const profiles = await this.credentialResolver.listProfiles();
    for (const profile of profiles) {
      if (profile.key) {
        this.credentialCache.set(profile.provider, profile.key);
      }
    }
    log.debug({ count: this.credentialCache.size }, 'Credential cache warmed');
  }

  async refreshCredentials(): Promise<void> {
    this.credentialCache.clear();
    await this.warmCredentialCache();
  }

  private resolveApiKeyWithCache(provider: string): string | undefined {
    const cached = this.credentialCache.get(provider);
    if (cached) return cached;
    return getApiKeySync(provider);
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
        thinkingLevel: this.config.thinkingLevel || 'medium',
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => this.resolveApiKeyWithCache(provider),
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
        const defaultModel = getDefaultModelSync(this.config.config);
        log.warn({ model: this.config.model, defaultModel }, 'Model not found, using default');
        return resolveModel(defaultModel);
      }
    }
    return resolveModel(getDefaultModelSync(this.config.config));
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

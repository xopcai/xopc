/**
 * Agent Manager - Manages Agent instances per session
 *
 * Each session gets its own Agent instance for true isolation
 * and concurrent processing across sessions.
 */

import {
  Agent,
  type AgentMessage,
  type AgentEvent,
  type ThinkingLevel,
} from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import {
  type EffectiveAgentProfile,
  resolveAgentBootstrapDir,
  resolveEffectiveAgentProfileForSession,
} from '../config/agent-profile.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';
import type { ModelManager } from './models/manager.js';
import { createLogger } from '../utils/logger.js';
import { resolveProviderApiKeySync } from '../auth/sync-provider-auth.js';
import { resolveModel, getDefaultModelSync, getApiKeySync } from '../providers/index.js';
import { CredentialResolver } from '../auth/credentials.js';
import { resolveBundledSkillsDir, resolveStateDir } from '../config/paths.js';
import { loadBootstrapFiles, extractTextContent, type BootstrapFile } from './context/workspace.js';
import { SkillManager } from './skills/index.js';
import { SystemPromptBuilder } from './prompt/service-prompt-builder.js';
import { AgentToolsFactory } from './tools/factory.js';
import type { GatewayClarifyRequestFn } from './tools/clarify-tool.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { CronService } from '../cron/index.js';
import type { SessionStore } from '../session/store.js';
import { isValidSkillEnvVarName } from './skills/required-env-vars.js';
import type { SessionContext } from './session/session-context.js';
import type { Skill } from './skills/types.js';
import { createSkillConfigManager } from './skills/config.js';
import { isUnderManagedSkillsDir } from './skills/managed-store.js';
import { loadSkillsLock, type SkillHubLockEntry } from './skills/hub-lock.js';
import { readFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

import { BuiltinMemoryStore } from './memory/builtin-memory-store.js';
import { createMemoryManagerFromConfig } from './memory/create-memory-manager.js';
import { injectPrefetchIntoUserMessage } from './memory/inject-prefetch.js';
import {
  isCuratedMemoryInPrompt,
  isMemorySubsystemEnabled,
  resolveBuiltinMemoryStoreConfig,
  shouldInjectMemoryPrefetchThisTurn,
} from './memory/memory-config.js';
import type { MemoryManager } from './memory/manager.js';
import type { MemorySnapshot } from './memory/types.js';
import { extractAgentUserPlainText } from './memory/user-message-text.js';

const log = createLogger('AgentManager');

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: Skill['source'];
  path: string;
  managed: boolean;
  /** User toggle in ~/.xopc/skills.json (`entries[name].enabled`). Default true. */
  enabled: boolean;
  /** When true, skill is never injected into `<available_skills>` (SKILL.md frontmatter). */
  disableModelInvocation: boolean;
  /** Hub install provenance when under ~/.xopc/skills and listed in skills-lock.json. */
  hub?: SkillHubLockEntry;
}

export interface AgentManagerConfig {
  workspace: string;
  model?: string;
  config?: Config;
  extensionRegistry?: ExtensionRegistry;
  bus: MessageBus;
  getCurrentContext: () => SessionContext | null;
  /** Session persistence (enables `session_search` when set). */
  getSessionStore?: () => SessionStore;
  /** Clears per-session profile default on teardown. */
  getModelManager?: () => ModelManager;
  // Thinking configuration
  thinkingLevel?: ThinkingLevel;
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseLevel?: 'off' | 'on' | 'full';
  gatewayClarify?: { requestClarification: GatewayClarifyRequestFn };
  /** Gateway: exposes CronService for the `cronjob` tool. */
  getCronService?: () => CronService | undefined;
}

export interface AgentInstance {
  agent: Agent;
  sessionKey: string;
  createdAt: number;
  lastUsedAt: number;
  /** Curated agent-home `memories/` snapshot frozen at agent creation (prefix cache). */
  curatedMemorySnapshot: MemorySnapshot;
  effectiveProfile: EffectiveAgentProfile;
  resolvedWorkspacePath: string;
  /** Tool names registered on this agent (for skill indexing / tool gating). */
  registeredToolNames: string[];
  /** Declared env var names from skill_view; shell reads values from process.env at spawn time. */
  skillEnvPassthroughKeys: Set<string>;
}

interface WorkspaceRuntime {
  skillManager: SkillManager;
  systemPromptBuilder: SystemPromptBuilder;
  builtinMemoryStore: BuiltinMemoryStore;
  memoryManager: MemoryManager;
}

export class AgentManager {
  private agents = new Map<string, AgentInstance>();
  private config: AgentManagerConfig;
  private toolsFactory: AgentToolsFactory;
  /** Default agent workspace (effective profile for `getDefaultAgentId`). */
  private baseWorkspacePath: string;
  private defaultModel: string;
  private credentialCache = new Map<string, string>();
  private credentialResolver: CredentialResolver;
  private workspaceRuntimes = new Map<string, WorkspaceRuntime>();
  /** Per-session user-message index for prefetch injection cadence. */
  private memoryPrefetchUserTurn = new Map<string, number>();

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.baseWorkspacePath = this.computeBaseWorkspacePath();
    const baseRt = this.getWorkspaceRuntime(this.baseWorkspacePath);

    this.toolsFactory = new AgentToolsFactory({
      workspace: this.baseWorkspacePath,
      extensionRegistry: config.extensionRegistry,
      getCurrentContext: config.getCurrentContext,
      bus: config.bus,
      getConfig: () => this.config.config,
      getPrimaryModel: () => this.resolveModelStringToModel(this.pickDefaultModelRef()),
      getBuiltinMemoryStore: () => baseRt.builtinMemoryStore,
      getMemoryManager: () => baseRt.memoryManager,
      getSessionStore: config.getSessionStore,
      gatewayClarify: config.gatewayClarify,
      getCronService: config.getCronService,
      getSkillIndexingContext: () => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return undefined;
        const inst = this.agents.get(ctx.sessionKey);
        if (!inst) return undefined;
        return {
          registeredToolNames: inst.registeredToolNames,
          skillAllowlist: inst.effectiveProfile.skillsAllowlist,
        };
      },
      onSkillsFilesystemMutate: () => {
        this.refreshSkillsAfterDiskChange();
      },
      getSkillPassthroughEnvVarNames: () => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return [];
        return [...(this.agents.get(ctx.sessionKey)?.skillEnvPassthroughKeys ?? [])];
      },
      registerSkillEnvPassthrough: (names: string[]) => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return;
        const inst = this.agents.get(ctx.sessionKey);
        if (!inst) return;
        for (const n of names) {
          if (isValidSkillEnvVarName(n)) {
            inst.skillEnvPassthroughKeys.add(n.trim());
          }
        }
      },
    });

    this.defaultModel = config.model || getDefaultModelSync(config.config);

    this.credentialResolver = new CredentialResolver();
    this.warmCredentialCache().catch((err) => {
      log.warn({ err }, 'Failed to pre-warm credential cache');
    });
  }

  private computeBaseWorkspacePath(): string {
    const cfg = this.config.config;
    if (!cfg) {
      return expandWorkspacePathString(this.config.workspace);
    }
    return resolveEffectiveAgentProfileForSession(cfg, null).resolvedWorkspacePath;
  }

  /**
   * Workspace root for inbound attachments / side effects for this session's agent id.
   */
  getResolvedWorkspaceForSession(sessionKey: string): string {
    const cfg = this.config.config!;
    return resolveEffectiveAgentProfileForSession(cfg, sessionKey).resolvedWorkspacePath;
  }

  /** Merged `thinkingDefault` for this session's agent id (defaults + `agents.list`). */
  getThinkingDefaultForSession(
    sessionKey: string,
  ): import('./transcript/thinking-types.js').ThinkLevel | undefined {
    const cfg = this.config.config;
    if (!cfg) {
      return undefined;
    }
    return resolveEffectiveAgentProfileForSession(cfg, sessionKey).thinkingDefault;
  }

  private getWorkspaceRuntime(resolvedPath: string): WorkspaceRuntime {
    const existing = this.workspaceRuntimes.get(resolvedPath);
    if (existing) {
      return existing;
    }

    const builtinMemoryStore = new BuiltinMemoryStore(
      resolveBuiltinMemoryStoreConfig(resolvedPath, this.config.config),
    );
    const memoryManager = createMemoryManagerFromConfig(
      resolvedPath,
      builtinMemoryStore,
      this.config.config,
    );
    const skillManager = new SkillManager(resolvedPath, resolveBundledSkillsDir());
    const systemPromptBuilder = new SystemPromptBuilder({
      workspace: resolvedPath,
      config: this.config.config!,
      skillManager,
    });

    const rt: WorkspaceRuntime = {
      skillManager,
      systemPromptBuilder,
      builtinMemoryStore,
      memoryManager,
    };
    this.workspaceRuntimes.set(resolvedPath, rt);
    return rt;
  }

  private pickDefaultModelRef(): string {
    const ref = getAgentDefaultModelRef(this.config.config);
    return ref?.trim() || getDefaultModelSync(this.config.config);
  }

  private resolveModelStringToModel(modelRef: string): Model<Api> {
    try {
      return resolveModel(modelRef);
    } catch {
      const fallback = getDefaultModelSync(this.config.config);
      log.warn({ modelRef, fallback }, 'Model not found, using default');
      return resolveModel(fallback);
    }
  }

  /**
   * Keep defaults in sync when config is hot-reloaded or saved from the UI.
   */
  updateAgentDefaults(config: Config): void {
    this.config.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.config.model = ref;
    this.defaultModel = ref || getDefaultModelSync(config);
    this.baseWorkspacePath = this.computeBaseWorkspacePath();
    void this.toolsFactory.shutdownBrowser();
    for (const rt of this.workspaceRuntimes.values()) {
      void rt.memoryManager.shutdownAll().catch(() => {});
    }
    this.workspaceRuntimes.clear();
    this.toolsFactory = new AgentToolsFactory({
      workspace: this.baseWorkspacePath,
      extensionRegistry: this.config.extensionRegistry,
      getCurrentContext: this.config.getCurrentContext,
      bus: this.config.bus,
      getConfig: () => this.config.config,
      getPrimaryModel: () => this.resolveModelStringToModel(this.pickDefaultModelRef()),
      getBuiltinMemoryStore: () => this.getWorkspaceRuntime(this.baseWorkspacePath).builtinMemoryStore,
      getMemoryManager: () => this.getWorkspaceRuntime(this.baseWorkspacePath).memoryManager,
      getSessionStore: this.config.getSessionStore,
      gatewayClarify: this.config.gatewayClarify,
      getCronService: this.config.getCronService,
      getSkillIndexingContext: () => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return undefined;
        const inst = this.agents.get(ctx.sessionKey);
        if (!inst) return undefined;
        return {
          registeredToolNames: inst.registeredToolNames,
          skillAllowlist: inst.effectiveProfile.skillsAllowlist,
        };
      },
      onSkillsFilesystemMutate: () => {
        this.refreshSkillsAfterDiskChange();
      },
      getSkillPassthroughEnvVarNames: () => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return [];
        return [...(this.agents.get(ctx.sessionKey)?.skillEnvPassthroughKeys ?? [])];
      },
      registerSkillEnvPassthrough: (names: string[]) => {
        const ctx = this.config.getCurrentContext?.();
        if (!ctx?.sessionKey) return;
        const inst = this.agents.get(ctx.sessionKey);
        if (!inst) return;
        for (const n of names) {
          if (isValidSkillEnvVarName(n)) {
            inst.skillEnvPassthroughKeys.add(n.trim());
          }
        }
      },
    });
  }

  getMemoryManager(): MemoryManager {
    return this.getWorkspaceRuntime(this.baseWorkspacePath).memoryManager;
  }

  private getMemoryManagerForSession(sessionKey: string): MemoryManager {
    const cfg = this.config.config!;
    const path = resolveEffectiveAgentProfileForSession(cfg, sessionKey).resolvedWorkspacePath;
    return this.getWorkspaceRuntime(path).memoryManager;
  }

  /**
   * Prefix the user turn with fenced prefetched memory (external providers).
   */
  async applyMemoryPrefetchToUserMessage(
    userMessage: AgentMessage,
    sessionKey: string,
  ): Promise<AgentMessage> {
    if (!isMemorySubsystemEnabled(this.config.config)) {
      return userMessage;
    }
    const plain = extractAgentUserPlainText(userMessage);
    const turn = (this.memoryPrefetchUserTurn.get(sessionKey) ?? 0) + 1;
    this.memoryPrefetchUserTurn.set(sessionKey, turn);
    if (!shouldInjectMemoryPrefetchThisTurn(this.config.config, turn)) {
      return userMessage;
    }
    return injectPrefetchIntoUserMessage(
      this.getMemoryManagerForSession(sessionKey),
      sessionKey,
      userMessage,
      plain,
    );
  }

  /**
   * After a completed turn: sync external providers and queue next-turn prefetch.
   */
  afterAgentTurn(sessionKey: string, userPlainText: string): void {
    if (!isMemorySubsystemEnabled(this.config.config)) {
      return;
    }
    const assistant = this.getLastAssistantContent(sessionKey) ?? '';
    const mm = this.getMemoryManagerForSession(sessionKey);
    mm.syncAll(userPlainText, assistant, { sessionId: sessionKey });
    mm.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
  }

  /**
   * Expand `/skill:name` user text into the full skill block for the current turn (WebChat, channels).
   */
  expandSkillUserText(text: string): string {
    const ctx = this.config.getCurrentContext?.();
    const path = ctx?.sessionKey
      ? this.getResolvedWorkspaceForSession(ctx.sessionKey)
      : this.baseWorkspacePath;
    return this.getWorkspaceRuntime(path).skillManager.expandCommand(text);
  }

  /**
   * Read raw SKILL.md from disk (including frontmatter) for UI preview.
   */
  getSkillMarkdownSource(skillName: string): { name: string; markdown: string } | null {
    const skill = this.getWorkspaceRuntime(this.baseWorkspacePath).skillManager.findSkill(skillName);
    if (!skill) return null;
    try {
      const markdown = readFileSync(skill.filePath, 'utf-8');
      return { name: skill.name, markdown };
    } catch (err) {
      log.warn({ err, skillName, path: skill.filePath }, 'Failed to read SKILL.md');
      return null;
    }
  }

  private loadBootstrapForProfile(profile: EffectiveAgentProfile): BootstrapFile[] {
    const cfg = this.config.config!;
    const bootstrapDir = resolveAgentBootstrapDir(cfg, profile.agentId);
    return loadBootstrapFiles(bootstrapDir);
  }

  getSkillCatalog(): SkillCatalogEntry[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    const lock = loadSkillsLock();
    return this.getWorkspaceRuntime(this.baseWorkspacePath).skillManager.getSkills().map((s) => {
      const base = resolve(s.baseDir);
      const managed = isUnderManagedSkillsDir(s.baseDir);
      const directoryId = base.split(sep).filter(Boolean).pop() || s.name;
      const enabled = !(skillsConfig.entries?.[s.name]?.enabled === false);
      const hubKey = managed ? basename(base) : '';
      const hub = managed && hubKey ? lock.entries[hubKey] : undefined;
      return {
        directoryId,
        name: s.name,
        description: s.description,
        source: s.source,
        path: s.baseDir,
        managed,
        enabled,
        disableModelInvocation: s.disableModelInvocation,
        ...(hub ? { hub } : {}),
      };
    });
  }

  /**
   * After ~/.xopc/skills.json changes (enable/disable), refresh `<available_skills>` on active agents.
   */
  refreshSkillsAfterSkillConfigChange(): void {
    const touched = new Set<string>();
    for (const instance of this.agents.values()) {
      const rt = this.getWorkspaceRuntime(instance.resolvedWorkspacePath);
      if (!touched.has(instance.resolvedWorkspacePath)) {
        rt.skillManager.refreshPromptFromConfig();
        touched.add(instance.resolvedWorkspacePath);
      }
      const bootstrapFiles = this.loadBootstrapForProfile(instance.effectiveProfile);
      const newPrompt = rt.systemPromptBuilder.build(bootstrapFiles, {
        curatedMemorySnapshot: instance.curatedMemorySnapshot,
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: instance.resolvedWorkspacePath,
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
      });
      instance.agent.setSystemPrompt(newPrompt);
    }
    log.info({ agents: this.agents.size }, 'Skill toggles applied; system prompt updated');
  }

  /**
   * Reload skills from disk and refresh system prompt on all active Agent instances.
   */
  refreshSkillsAfterDiskChange(): void {
    const touched = new Set<string>();
    for (const instance of this.agents.values()) {
      const rt = this.getWorkspaceRuntime(instance.resolvedWorkspacePath);
      if (!touched.has(instance.resolvedWorkspacePath)) {
        touched.add(instance.resolvedWorkspacePath);
      }
      const bootstrapFiles = this.loadBootstrapForProfile(instance.effectiveProfile);
      const newPrompt = rt.systemPromptBuilder.rebuild(bootstrapFiles, {
        curatedMemorySnapshot: instance.curatedMemorySnapshot,
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: instance.resolvedWorkspacePath,
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
      });
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

    const cfg = this.config.config!;
    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const resolvedPath = profile.resolvedWorkspacePath;
    const rt = this.getWorkspaceRuntime(resolvedPath);

    if (isMemorySubsystemEnabled(cfg)) {
      void rt.memoryManager
        .initializeAll(sessionKey, { workspace: resolvedPath })
        .catch((err) => log.warn({ err, sessionKey }, 'memory initializeAll failed'));
    }

    const curatedOn = isCuratedMemoryInPrompt(cfg);
    if (curatedOn) {
      rt.builtinMemoryStore.loadFromDiskSync();
    }
    const snap = curatedOn ? rt.builtinMemoryStore.getSnapshot() : { memory: '', user: '' };
    const curatedMemorySnapshot: MemorySnapshot = { memory: snap.memory, user: snap.user };

    const { agent, registeredToolNames } = this.createAgentForProfile(
      sessionKey,
      profile,
      rt,
      curatedMemorySnapshot,
    );

    this.agents.set(sessionKey, {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      curatedMemorySnapshot,
      effectiveProfile: profile,
      resolvedWorkspacePath: resolvedPath,
      registeredToolNames,
      skillEnvPassthroughKeys: new Set<string>(),
    });

    const modelRef = profile.primaryModelRef?.trim() || this.defaultModel;
    this.config.getModelManager?.().setSessionProfileDefault(sessionKey, modelRef);

    log.debug({ sessionKey, totalAgents: this.agents.size, agentId: profile.agentId }, 'Created new agent instance');
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
      void this.toolsFactory.closeBrowserPageForSession(sessionKey);
      instance.agent.abort();
      this.agents.delete(sessionKey);
      this.memoryPrefetchUserTurn.delete(sessionKey);
      this.config.getModelManager?.().clearSessionProfileDefault(sessionKey);
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
    void this.toolsFactory.shutdownBrowser();
    for (const instance of this.agents.values()) {
      instance.agent.abort();
    }
    this.agents.clear();
    this.memoryPrefetchUserTurn.clear();
    for (const rt of this.workspaceRuntimes.values()) {
      void rt.memoryManager.shutdownAll().catch(() => {});
    }
    this.workspaceRuntimes.clear();
    log.debug('All agent instances disposed');
  }

  async warmCredentialCache(): Promise<void> {
    const profiles = await this.credentialResolver.listProfiles();
    for (const profile of profiles) {
      const secret = profile.key?.trim()
        ? profile.key.trim()
        : profile.envVar
          ? process.env[profile.envVar]?.trim()
          : undefined;
      if (secret) {
        this.credentialCache.set(profile.provider.toLowerCase(), secret);
      }
    }
    log.debug({ count: this.credentialCache.size }, 'Credential cache warmed');
  }

  async refreshCredentials(): Promise<void> {
    this.credentialCache.clear();
    await this.warmCredentialCache();
  }

  private resolveApiKeyWithCache(provider: string): string | undefined {
    const key = provider.toLowerCase();
    const cached = this.credentialCache.get(key);
    if (cached) return cached;

    const fromDisk = resolveProviderApiKeySync(provider);
    if (fromDisk) {
      this.credentialCache.set(key, fromDisk);
      return fromDisk;
    }

    const fromRegistryOrEnv = getApiKeySync(provider);
    if (fromRegistryOrEnv) {
      this.credentialCache.set(key, fromRegistryOrEnv);
      return fromRegistryOrEnv;
    }
    return undefined;
  }

  private createAgentForProfile(
    _sessionKey: string,
    profile: EffectiveAgentProfile,
    rt: WorkspaceRuntime,
    curatedMemorySnapshot: MemorySnapshot,
  ): { agent: Agent; registeredToolNames: string[] } {
    const modelRef = profile.primaryModelRef?.trim() || this.defaultModel;
    const model = this.resolveModelStringToModel(modelRef);

    const bootstrapFiles = this.loadBootstrapForProfile(profile);
    const tools = this.toolsFactory.createAllTools({
      workspace: profile.resolvedWorkspacePath,
      disabledTools: profile.tools.disable,
      getPrimaryModel: () => this.resolveModelStringToModel(modelRef),
      getBuiltinMemoryStore: () => rt.builtinMemoryStore,
      getMemoryManager: () => rt.memoryManager,
      getSkillManager: () => rt.skillManager,
    });
    const registeredToolNames = tools.map((t) => t.name);

    const thinkingLevel =
      (profile.thinkingDefault as ThinkingLevel | undefined) ?? this.config.thinkingLevel ?? 'medium';

    const agent = new Agent({
      initialState: {
        systemPrompt: rt.systemPromptBuilder.build(bootstrapFiles, {
          curatedMemorySnapshot,
          externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
          workspaceOverride: profile.resolvedWorkspacePath,
          systemPromptOverride: profile.systemPromptOverride,
          skillAllowlist: profile.skillsAllowlist,
          registeredToolNames,
        }),
        model,
        thinkingLevel,
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => this.resolveApiKeyWithCache(provider),
    });
    return { agent, registeredToolNames };
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

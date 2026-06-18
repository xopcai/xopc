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
} from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';
import type { AgentInstanceGateway } from './agent-instance-gateway.js';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { applyConfigOverrides } from '../config/runtime-overrides.js';
import { resolveAgentProfileDir } from './agent-scope.js';
import {
  type EffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../config/agent-profile.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';
import type { ModelManager } from './models/manager.js';
import { createLogger } from '../utils/logger.js';
import { resolveProviderApiKeySync } from '../auth/sync-provider-auth.js';
import { resolveModel, getDefaultModelSync, getApiKeySync } from '../providers/index.js';
import { createExtensionAwareStreamFn } from '../providers/extension-stream-bridge.js';
import { CredentialResolver } from '../auth/credentials.js';
import { resolveBundledSkillsDir, resolveStateDir } from '../config/paths.js';
import { loadProfileMarkdownFiles, extractTextContent } from './context/workspace.js';
import { clearBootstrapSnapshot, resolveBootstrapContextSync } from './bootstrap/bootstrap-files.js';
import type { EmbeddedContextFile } from './bootstrap/types.js';
import { AgentToolsFactory } from './tools/factory.js';
import { parseMcpToolName } from './mcp/bundle-mcp-policy.js';
import {
  disposeAllSessionMcpRuntimes,
  retireSessionMcpRuntimeForSessionKey,
} from './mcp/bundle-mcp-tools.js';
import { evictAllEmbeddedSessionRunners, evictEmbeddedSessionRunner } from './embedded/session-runner.js';
import type { GatewayClarifyRequestFn } from './tools/clarify-tool.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { CronService } from '../cron/index.js';
import type { SessionStore } from '../session/store.js';
import { isValidSkillEnvVarName } from './skills/required-env-vars.js';
import type { SessionContext } from './session/session-context.js';
import type { Skill, SkillMarkdownPreviewPayload } from './skills/types.js';
import { createSkillConfigManager } from './skills/config.js';
import { isUnderManagedSkillsDir } from './skills/managed-store.js';
import { loadSkillsLock, type SkillHubLockEntry } from './skills/hub-lock.js';
import { basename, resolve, sep } from 'node:path';

import {
  isMemorySubsystemEnabled,
  shouldRegisterCuratedMemoryTool,
} from './memory/memory-config.js';
import type { MemoryManager } from './memory/manager.js';
import { MemoryPrefetchCoordinator } from './memory/prefetch-coordinator.js';
import { WorkspaceRuntimeRegistry, type WorkspaceRuntime } from './workspace-runtime/registry.js';
import { BackgroundReviewCoordinator } from './background-review/coordinator.js';
import { maybeRequestChannelExecApproval } from '../channels/exec-approval-runtime.js';

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
  hookRunner?: import('../extensions/index.js').ExtensionHookRunner;
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
  /** Gateway: starts persisted workflow runs (dedicated chat session per run). */
  getWorkflowRunService?: () => import('../workflows/service/workflow-run-service.types.js').WorkflowRunServiceLike | undefined;
}

export interface AgentInstance {
  agent: Agent;
  sessionKey: string;
  createdAt: number;
  lastUsedAt: number;
  effectiveProfile: EffectiveAgentProfile;
  resolvedWorkspacePath: string;
  /** Tool names registered on this agent (for skill indexing / tool gating). */
  registeredToolNames: string[];
  /** Declared env var names from skill_view; shell reads values from process.env at spawn time. */
  skillEnvPassthroughKeys: Set<string>;
}


export class AgentManager implements AgentInstanceGateway {
  private agents = new Map<string, AgentInstance>();
  private config: AgentManagerConfig;
  private toolsFactory: AgentToolsFactory;

  private mergedConfig(): Config | undefined {
    const base = this.config.config;
    return base ? applyConfigOverrides(base) : undefined;
  }
  /** Default agent workspace (effective profile for `getDefaultAgentId`). */
  private baseWorkspacePath: string;
  /** Per-session absolute markdown workspace when `SessionAgentConfig.workingDirectoryOverride` is set. */
  private sessionWorkspaceOverrides = new Map<string, string>();
  private defaultModel: string;
  private credentialCache = new Map<string, string>();
  private credentialResolver: CredentialResolver;
  private workspaceRuntimes: WorkspaceRuntimeRegistry;
  private memoryPrefetch: MemoryPrefetchCoordinator;
  private backgroundReview: BackgroundReviewCoordinator;

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.baseWorkspacePath = this.computeBaseWorkspacePath();
    this.workspaceRuntimes = new WorkspaceRuntimeRegistry({
      getConfig: () => this.config.config!,
      bundledSkillsDir: resolveBundledSkillsDir(),
    });
    this.memoryPrefetch = new MemoryPrefetchCoordinator({
      getConfig: () => this.config.config,
      getMemoryManagerForSession: (sk) => this.getMemoryManagerForSession(sk),
      getLastAssistantContent: (sk) => this.getLastAssistantContent(sk),
    });
    this.backgroundReview = new BackgroundReviewCoordinator({
      getConfig: () => this.mergedConfig(),
      onSkillsFilesystemMutate: () => this.refreshSkillsAfterDiskChange(),
    });
    this.toolsFactory = new AgentToolsFactory(this.buildToolsFactoryDeps());

    this.defaultModel = config.model || getDefaultModelSync(config.config);

    this.credentialResolver = new CredentialResolver();
    this.warmCredentialCache().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Credential cache pre-warm failed: ${em}`);
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
   * Uses in-memory session workspace overrides when the session has a persisted `workingDirectoryOverride`.
   */
  getResolvedWorkspaceForSession(sessionKey: string): string {
    const cfg = this.config.config!;
    const fromMap = this.sessionWorkspaceOverrides.get(sessionKey);
    if (fromMap !== undefined) {
      return fromMap;
    }
    return resolveEffectiveAgentProfileForSession(cfg, sessionKey).resolvedWorkspacePath;
  }

  /**
   * Sync in-memory workspace override from session config (after load or PATCH).
   * Pass `null` to clear when the session has no `workingDirectoryOverride` on disk.
   */
  setSessionWorkspaceOverride(sessionKey: string, absolutePath: string | null): void {
    if (absolutePath === null || absolutePath === '') {
      this.sessionWorkspaceOverrides.delete(sessionKey);
    } else {
      this.sessionWorkspaceOverrides.set(sessionKey, absolutePath);
    }
  }

  /** Merged `thinkingDefault` for this session's agent id (defaults + `agents.list`). */
  getThinkingDefaultForSession(
    sessionKey: string,
  ): import('./transcript/thinking-types.js').ThinkLevel | undefined {
    const cfg = this.mergedConfig();
    if (!cfg) {
      return undefined;
    }
    return resolveEffectiveAgentProfileForSession(cfg, sessionKey).thinkingDefault;
  }

  private pickDefaultModelRef(): string {
    const cfg = this.mergedConfig();
    const ref = getAgentDefaultModelRef(cfg);
    return ref?.trim() || getDefaultModelSync(cfg);
  }

  private resolveModelStringToModel(modelRef: string): Model<Api> {
    try {
      return resolveModel(modelRef);
    } catch {
      const fallback = getDefaultModelSync(this.mergedConfig());
      log.warn({ modelRef, fallback }, 'Model not found, using default');
      return resolveModel(fallback);
    }
  }

  /**
   * Keep defaults in sync when config is hot-reloaded or saved from the UI.
   *
   * The previous implementation rebuilt the entire `AgentToolsFactory` (80+ lines
   * of dependency wiring) on every reload. The factory's deps are now built from
   * a single helper ({@link buildToolsFactoryDeps}) and read `this.*` through
   * closures, so existing instances automatically see the new config without
   * reconstruction. The browser is still shut down because its cached settings
   * (headless mode, backend choice) come from the config snapshot at connect time.
   */
  updateAgentDefaults(config: Config): void {
    this.config.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.config.model = ref;
    this.defaultModel = ref || getDefaultModelSync(config);
    this.baseWorkspacePath = this.computeBaseWorkspacePath();
    void this.toolsFactory.shutdownBrowser();
    void this.workspaceRuntimes.clearAll();
  }

  /**
   * Construct the dep bag passed to `AgentToolsFactory`. Closures reference
   * `this.*` so they remain valid across hot reloads (no rebuild needed).
   */
  private buildToolsFactoryDeps(): ConstructorParameters<typeof AgentToolsFactory>[0] {
    return {
      workspace: this.baseWorkspacePath,
      extensionRegistry: this.config.extensionRegistry,
      getCurrentContext: this.config.getCurrentContext,
      hookRunner: this.config.hookRunner,
      bus: this.config.bus,
      getConfig: () => this.mergedConfig(),
      getPrimaryModel: () => this.resolveModelStringToModel(this.pickDefaultModelRef()),
      getBuiltinMemoryStore: () =>
        this.workspaceRuntimes.getOrCreate(this.baseWorkspacePath).builtinMemoryStore,
      getMemoryManager: () =>
        this.workspaceRuntimes.getOrCreate(this.baseWorkspacePath).memoryManager,
      getSessionStore: this.config.getSessionStore,
      gatewayClarify: this.config.gatewayClarify,
      getCronService: this.config.getCronService,
      getWorkflowRunService: this.config.getWorkflowRunService,
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
    };
  }

  getMemoryManager(): MemoryManager {
    return this.workspaceRuntimes.getOrCreate(this.baseWorkspacePath).memoryManager;
  }

  private getMemoryManagerForSession(sessionKey: string): MemoryManager {
    const path = this.getResolvedWorkspaceForSession(sessionKey);
    return this.workspaceRuntimes.getOrCreate(path).memoryManager;
  }

  /**
   * Prefix the user turn with fenced prefetched memory (external providers).
   * Delegates to {@link MemoryPrefetchCoordinator}.
   */
  applyMemoryPrefetchToUserMessage(
    userMessage: AgentMessage,
    sessionKey: string,
  ): Promise<AgentMessage> {
    return this.memoryPrefetch.applyToUserMessage(userMessage, sessionKey);
  }

  /**
   * After a completed turn: sync external providers and queue next-turn prefetch.
   * Delegates to {@link MemoryPrefetchCoordinator}.
   */
  afterAgentTurn(sessionKey: string, userPlainText: string): void {
    this.memoryPrefetch.afterTurn(sessionKey, userPlainText);
  }

  /**
   * Call once per user turn before the main `agent.prompt` (via {@link runAgentTurnWithModelFallbacks} `beforeUserPrompt`).
   * Delegates to {@link BackgroundReviewCoordinator}.
   */
  beginBackgroundReviewUserTurn(sessionKey: string): void {
    const inst = this.agents.get(sessionKey);
    if (!inst) return;
    this.backgroundReview.beginUserTurn(sessionKey, inst.registeredToolNames);
  }

  /**
   * After a successful main turn (after memory sync via `afterAgentTurn`), may run a quiet follow-up for memory/skills.
   * Delegates to {@link BackgroundReviewCoordinator}.
   */
  scheduleBackgroundReviewAfterUserTurn(sessionKey: string): void {
    const inst = this.agents.get(sessionKey);
    if (!inst) return;
    this.backgroundReview.scheduleAfterUserTurn({
      sessionKey,
      agent: inst.agent,
      registeredToolNames: inst.registeredToolNames,
      skillAllowlist: inst.effectiveProfile.skillsAllowlist,
      workspacePath: inst.resolvedWorkspacePath,
      lastAssistantText: this.getLastAssistantContent(sessionKey),
      workspaceRuntime: this.workspaceRuntimes.getOrCreate(inst.resolvedWorkspacePath),
    });
  }

  /**
   * Expand `/skill:name` user text into the full skill block for the current turn (WebChat, channels).
   */
  expandSkillUserText(text: string): string {
    const ctx = this.config.getCurrentContext?.();
    const sessionKey = ctx?.sessionKey;
    const path = sessionKey
      ? this.getResolvedWorkspaceForSession(sessionKey)
      : this.baseWorkspacePath;
    const inst = sessionKey ? this.agents.get(sessionKey) : undefined;
    return this.workspaceRuntimes.getOrCreate(path).skillManager.expandCommand(text, {
      skillAllowlist: inst?.effectiveProfile.skillsAllowlist,
      registeredToolNames: inst?.registeredToolNames,
    });
  }

  /** Structured SKILL.md preview for the gateway console. */
  getSkillMarkdownSource(skillName: string): SkillMarkdownPreviewPayload | null {
    const skill = this.workspaceRuntimes.getOrCreate(this.baseWorkspacePath).skillManager.findSkill(skillName);
    if (!skill) return null;

    return {
      name: skill.name,
      description: skill.description,
      bodyMarkdown: skill.content,
      disableModelInvocation: skill.disableModelInvocation,
      metadata: skill.metadata,
      toolConditions: skill.toolConditions,
      requiredEnvVarNames: skill.requiredEnvVarNames,
    };
  }

  private loadProfileMarkdownForProfile(profile: EffectiveAgentProfile): ReturnType<typeof loadProfileMarkdownFiles> {
    const cfg = this.config.config!;
    const profileDir = resolveAgentProfileDir(cfg, profile.agentId);
    return loadProfileMarkdownFiles(profileDir);
  }

  private resolveContextFilesForSession(
    sessionKey: string,
    profile: EffectiveAgentProfile,
    excludeHeartbeat?: boolean,
  ): EmbeddedContextFile[] {
    const cfg = this.config.config!;
    const profileDir = resolveAgentProfileDir(cfg, profile.agentId);
    const heartbeatEnabled = cfg.gateway?.heartbeat?.includeSystemPromptSection ?? false;
    const contextInjection = cfg.agents?.defaults?.contextInjection ?? 'always';
    const { contextFiles } = resolveBootstrapContextSync({
      profileDir,
      config: cfg,
      sessionKey,
      excludeHeartbeat: excludeHeartbeat ?? !heartbeatEnabled,
      contextInjection,
    });
    return contextFiles;
  }

  getSkillCatalog(): SkillCatalogEntry[] {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    const lock = loadSkillsLock();
    return this.workspaceRuntimes.getOrCreate(this.baseWorkspacePath).skillManager.getSkills().map((s) => {
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
        category: s.category,
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
    const cfg = this.config.config!;
    const touched = new Set<string>();
    for (const instance of this.agents.values()) {
      const rt = this.workspaceRuntimes.getOrCreate(instance.resolvedWorkspacePath);
      if (!touched.has(instance.resolvedWorkspacePath)) {
        rt.skillManager.refreshPromptFromConfig();
        touched.add(instance.resolvedWorkspacePath);
      }
      const contextFiles = this.resolveContextFilesForSession(
        instance.sessionKey,
        instance.effectiveProfile,
      );
      const newPrompt = rt.systemPromptBuilder.build(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: instance.resolvedWorkspacePath,
        profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
        sessionKey: instance.sessionKey,
        modelRef: instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel,
        agentId: instance.effectiveProfile.agentId,
        thinkingLevel:
          (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
          this.config.thinkingLevel ??
          'medium',
      });
      instance.agent.state.systemPrompt = newPrompt;
    }
    log.info({ agents: this.agents.size }, 'Skill toggles applied; system prompt updated');
  }

  /**
   * Reload skills from disk and refresh system prompt on all active Agent instances.
   */
  refreshSkillsAfterDiskChange(): void {
    const cfg = this.config.config!;
    // Reload every workspace SkillManager first. When there are no active agent sessions
    // (e.g. gateway UI only), the loop below runs zero times — without this, `getSkillCatalog()`
    // and delete flows still see stale in-memory skills after ~/.xopc/skills changes.
    for (const rt of this.workspaceRuntimes.values()) {
      rt.skillManager.reload();
    }

    const touched = new Set<string>();
    for (const instance of this.agents.values()) {
      const rt = this.workspaceRuntimes.getOrCreate(instance.resolvedWorkspacePath);
      if (!touched.has(instance.resolvedWorkspacePath)) {
        touched.add(instance.resolvedWorkspacePath);
      }
      const contextFiles = this.resolveContextFilesForSession(
        instance.sessionKey,
        instance.effectiveProfile,
      );
      const newPrompt = rt.systemPromptBuilder.rebuild(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: instance.resolvedWorkspacePath,
        profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
        sessionKey: instance.sessionKey,
        modelRef: instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel,
        agentId: instance.effectiveProfile.agentId,
        thinkingLevel:
          (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
          this.config.thinkingLevel ??
          'medium',
      });
      instance.agent.state.systemPrompt = newPrompt;
    }
    log.info({ agents: this.agents.size }, 'Skills refreshed; system prompt updated');
  }

  /**
   * Get or create an Agent instance for a session
   */
  getOrCreateAgent(sessionKey: string): Agent {
    const cfg = this.config.config!;
    const targetPath = this.getResolvedWorkspaceForSession(sessionKey);
    const existing = this.agents.get(sessionKey);
    if (existing) {
      if (existing.resolvedWorkspacePath !== targetPath) {
        this.removeAgent(sessionKey);
      } else {
        existing.lastUsedAt = Date.now();
        log.debug({ sessionKey }, 'Reusing existing agent instance');
        return existing.agent;
      }
    }

    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const resolvedPath = targetPath;
    const rt = this.workspaceRuntimes.getOrCreate(resolvedPath);

    if (isMemorySubsystemEnabled(cfg)) {
      void rt.memoryManager
        .initializeAll(sessionKey, { workspace: resolvedPath })
        .catch((err) => log.warn({ err, sessionKey }, 'memory initializeAll failed'));
    }

    if (isMemorySubsystemEnabled(cfg) && shouldRegisterCuratedMemoryTool(cfg)) {
      rt.builtinMemoryStore.loadFromDiskSync();
    }

    const { agent, registeredToolNames } = this.createAgentForProfile(
      sessionKey,
      profile,
      resolvedPath,
      rt,
    );

    this.agents.set(sessionKey, {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      effectiveProfile: profile,
      resolvedWorkspacePath: resolvedPath,
      registeredToolNames,
      skillEnvPassthroughKeys: new Set<string>(),
    });

    this.backgroundReview.attachToAgent(sessionKey, agent, registeredToolNames);

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
      this.backgroundReview.forgetSession(sessionKey);
      void this.toolsFactory.closeBrowserPageForSession(sessionKey);
      void retireSessionMcpRuntimeForSessionKey({ sessionKey, reason: 'agent-evict' });
      instance.agent.abort();
      evictEmbeddedSessionRunner(sessionKey, 'agent_removed');
      this.agents.delete(sessionKey);
      this.memoryPrefetch.forgetSession(sessionKey);
      clearBootstrapSnapshot(sessionKey);
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
   * Merge per-turn channel system prompt (e.g. Telegram group/topic override) into the agent.
   */
  applyTurnChannelSystemPrompt(sessionKey: string, channelSystemPrompt: string): void {
    const trimmed = channelSystemPrompt.trim();
    if (!trimmed) return;

    const instance = this.agents.get(sessionKey);
    if (!instance) return;

    const cfg = this.config.config!;
    const rt = this.workspaceRuntimes.getOrCreate(instance.resolvedWorkspacePath);
    const contextFiles = this.resolveContextFilesForSession(sessionKey, instance.effectiveProfile);
    const modelRef = instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel;
    const thinkingLevel =
      (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
      this.config.thinkingLevel ??
      'medium';

    instance.agent.state.systemPrompt = rt.systemPromptBuilder.build(contextFiles, {
      externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
      workspaceOverride: instance.resolvedWorkspacePath,
      profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
      systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
      skillAllowlist: instance.effectiveProfile.skillsAllowlist,
      registeredToolNames: instance.registeredToolNames,
      sessionKey,
      modelRef,
      agentId: instance.effectiveProfile.agentId,
      thinkingLevel,
      extraSystemPrompt: trimmed,
    });
  }

  /**
   * Set thinking level for a session's agent
   */
  setThinkingLevel(sessionKey: string, level: ThinkingLevel): void {
    const instance = this.agents.get(sessionKey);
    if (instance) {
      instance.agent.state.thinkingLevel = level;
      log.debug({ sessionKey, thinkingLevel: level }, 'Set thinking level for agent');
    }
  }

  /**
   * Dispose all agents
   */
  dispose(): void {
    void this.toolsFactory.shutdownBrowser();
    void disposeAllSessionMcpRuntimes().catch(() => {});
    evictAllEmbeddedSessionRunners('agent_manager_dispose');
    this.backgroundReview.clear();
    for (const instance of this.agents.values()) {
      instance.agent.abort();
    }
    this.agents.clear();
    this.memoryPrefetch.clear();
    this.sessionWorkspaceOverrides.clear();
    void this.workspaceRuntimes.clearAll();
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
    sessionKey: string,
    profile: EffectiveAgentProfile,
    resolvedWorkspacePath: string,
    rt: WorkspaceRuntime,
  ): { agent: Agent; registeredToolNames: string[] } {
    const modelRef = profile.primaryModelRef?.trim() || this.defaultModel;
    const model = this.resolveModelStringToModel(modelRef);

    const contextFiles = this.resolveContextFilesForSession(sessionKey, profile);
    const tools = this.toolsFactory.createAllTools({
      workspace: resolvedWorkspacePath,
      profileMarkdownRoot: resolveAgentProfileDir(this.config.config!, profile.agentId),
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
        systemPrompt: rt.systemPromptBuilder.build(contextFiles, {
          externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
          workspaceOverride: resolvedWorkspacePath,
          profileMarkdownPathRoot: resolveAgentProfileDir(this.config.config!, profile.agentId),
          systemPromptOverride: profile.systemPromptOverride,
          skillAllowlist: profile.skillsAllowlist,
          registeredToolNames,
          sessionKey,
          modelRef,
          agentId: profile.agentId,
          thinkingLevel,
        }),
        model,
        thinkingLevel,
        tools,
        messages: [],
      },
      streamFn: createExtensionAwareStreamFn(),
      getApiKey: (provider: string) => this.resolveApiKeyWithCache(provider),
      beforeToolCall: async ({ toolCall, args }) => {
        const toolName = toolCall.name;

        if (toolName === 'shell') {
          const ctx = this.config.getCurrentContext();
          const cfg = this.mergedConfig();
          if (ctx && cfg) {
            const command =
              typeof (args as { command?: unknown })?.command === 'string'
                ? (args as { command: string }).command
                : JSON.stringify(args ?? {});
            const accountId =
              typeof ctx.metadata?.accountId === 'string' ? ctx.metadata.accountId : undefined;
            const approval = await maybeRequestChannelExecApproval({
              cfg,
              payload: {
                sessionKey: ctx.sessionKey,
                channel: ctx.channel,
                chatId: ctx.chatId,
                accountId,
                toolName,
                summary: command.slice(0, 500),
                details: { command: command.slice(0, 2000) },
              },
            });
            if (approval.required && !approval.approved) {
              return {
                block: true,
                reason: approval.reason ?? 'Exec approval denied or timed out.',
              };
            }
          }
        }

        if (!this.config.hookRunner) {
          return undefined;
        }
        const parsed = parseMcpToolName(toolName);
        const hookResult = await this.config.hookRunner.runBeforeToolCall(
          toolName,
          (args ?? {}) as Record<string, unknown>,
          {
            sessionKey,
            isMcpTool: parsed !== null,
            mcpServerId: parsed?.serverId,
          },
        );
        if (!hookResult.allowed) {
          return { block: true, reason: hookResult.reason ?? 'Tool call blocked by policy hook.' };
        }
        return undefined;
      },
    });
    return { agent, registeredToolNames };
  }

  /**
   * Set model for a specific session
   */
  setModelForSession(sessionKey: string, modelId: string): boolean {
    const instance = this.agents.get(sessionKey);
    if (!instance) {
      log.warn(
        { sessionKey, modelId, activeSessionCount: this.agents.size },
        `setModelForSession: no agent instance for session (create session / run turn first); modelId=${modelId}`,
      );
      return false;
    }

    try {
      const model = resolveModel(modelId);
      instance.agent.state.model = model;

      const cfg = this.config.config!;
      const rt = this.workspaceRuntimes.getOrCreate(instance.resolvedWorkspacePath);
      const contextFiles = this.resolveContextFilesForSession(
        sessionKey,
        instance.effectiveProfile,
      );
      const thinkingLevel =
        (instance.agent.state.thinkingLevel as ThinkingLevel | undefined) ??
        (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
        this.config.thinkingLevel ??
        'medium';

      instance.agent.state.systemPrompt = rt.systemPromptBuilder.build(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: instance.resolvedWorkspacePath,
        profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
        sessionKey,
        modelRef: modelId,
        agentId: instance.effectiveProfile.agentId,
        thinkingLevel,
      });

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

    instance.agent.state.messages = messages;
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

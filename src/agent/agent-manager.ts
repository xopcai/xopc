/**
 * Agent Manager - Manages Agent instances per session
 *
 * Each session gets its own Agent instance for true isolation
 * and concurrent processing across sessions.
 */

import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type ThinkingLevel,
} from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';
import type { AgentInstanceGateway } from './agent-instance-gateway.js';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { applyConfigOverrides } from '../config/runtime-overrides.js';
import { resolveAgentHomeDir, resolveAgentProfileDir } from './agent-scope.js';
import {
  type EffectiveAgentProfile,
  resolveEffectiveAgentProfile,
  resolveEffectiveAgentProfileForSession,
} from '../config/agent-profile.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';
import type { ModelManager } from './models/manager.js';
import { createLogger } from '../utils/logger.js';
import { resolveProviderApiKeySync } from '../auth/sync-provider-auth.js';
import { resolveModel, getDefaultModelSync, getApiKeySync } from '../providers/index.js';
import { createExtensionAwareStreamFn } from '../providers/extension-stream-bridge.js';
import { CredentialResolver } from '../auth/credentials.js';
import { resolveBundledSkillsDir, resolveStateDir, resolveUserProfilePath } from '../config/paths.js';
import { extractTextContent } from './context/workspace.js';
import { buildActiveProjectContextForPrompt } from './context/project-context.js';
import { clearBootstrapSnapshot, resolveBootstrapContextSync } from './bootstrap/bootstrap-files.js';
import { loadProjectAgentsContextFile } from './bootstrap/project-agents-context.js';
import type { EmbeddedContextFile } from './bootstrap/types.js';
import { AgentToolsFactory } from './tools/factory.js';
import type {
  SkillInstallToolOptions,
  SkillInstallToolResult,
} from './tools/skill-install-tool.js';
import {
  createAgentCapabilitySessionState,
  resolveAgentCapabilityCatalog,
  type AgentCapabilityCatalogEntry,
  type AgentCapabilitySessionState,
} from './capabilities/index.js';
import { parseMcpToolName } from './mcp/bundle-mcp-policy.js';
import {
  disposeAllSessionMcpRuntimes,
  retireSessionMcpRuntimeForSessionKey,
} from './mcp/bundle-mcp-tools.js';
import { evictAllEmbeddedSessionRunners, evictEmbeddedSessionRunner } from './embedded/session-runner.js';
import type { GatewayClarifyRequestFn } from './tools/clarify-tool.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { AutomationService } from '../automations/index.js';
import type { SessionStore } from '../session/store.js';
import type { NotesService } from '../notes/index.js';
import type { ProjectService } from '../projects/index.js';
import type { WorkItemService } from '../work-items/index.js';
import { isValidSkillEnvVarName } from './skills/required-env-vars.js';
import type { SessionContext } from './session/session-context.js';
import type {
  Skill,
  SkillDiagnostic,
  SkillMarkdownPreviewPayload,
  SkillRuntimeStatus,
} from './skills/types.js';
import { createSkillConfigManager, isSkillEnabled, resolveSkillConfig } from './skills/config.js';
import { isUnderManagedSkillsDir } from './skills/managed-store.js';
import { loadSkillsLock, type SkillHubLockEntry, type SkillsLockFile } from './skills/hub-lock.js';
import { basename, join, resolve, sep } from 'node:path';

import {
  isMemorySubsystemEnabled,
  shouldRegisterCuratedMemoryTool,
} from './memory/memory-config.js';
import type { MemoryManager } from './memory/manager.js';
import { MemoryPrefetchCoordinator } from './memory/prefetch-coordinator.js';
import { WorkspaceRuntimeRegistry, type WorkspaceRuntime } from './workspace-runtime/registry.js';
import { BackgroundReviewCoordinator } from './background-review/coordinator.js';
import { maybeRequestChannelExecApproval } from '../channels/exec-approval-runtime.js';
import { SkillFilesystemWatcher } from './skills/filesystem-watcher.js';
import { resolveWorkspaceSkillsDir, resolveWorkspaceSkillsLockPath } from './skills/workspace-skills-dir.js';
import { ProjectTrustStore, hasTrustRequiringProjectResources } from '../project-trust/trust-store.js';

const log = createLogger('AgentManager');

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  category?: string;
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

export interface SkillCatalogRuntimeMeta {
  version: string;
  loadedAt: number;
  diagnostics: SkillDiagnostic[];
  status: SkillRuntimeStatus;
}

export interface SkillCatalogSnapshot extends SkillCatalogRuntimeMeta {
  catalog: SkillCatalogEntry[];
}

export type AgentSkillUnavailableReason = 'agent-denied' | 'disabled' | 'requirements-unmet' | 'model-invocation-disabled';

export interface AgentSkillAvailabilityEntry extends SkillCatalogEntry {
  availableForCurrentAgent: boolean;
  unavailableReason: AgentSkillUnavailableReason | null;
}

export interface AgentSkillAvailabilityPayload {
  agentId: string;
  version: string;
  loadedAt: number;
  diagnostics: SkillDiagnostic[];
  status: SkillRuntimeStatus;
  defaultsAllowlist?: string[];
  agentAllowlist?: string[];
  effectiveAllowlist?: string[];
  skills: AgentSkillAvailabilityEntry[];
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
  /** Gateway: exposes AutomationService for the `automation` tool. */
  getAutomationService?: () => AutomationService | undefined;
  /** Gateway: exposes first-class xopc product objects for the `xopc_use` tool. */
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getWorkItemService?: () => WorkItemService | undefined;
  /** Gateway: starts persisted workflow runs (dedicated chat session per run). */
  getWorkflowRunService?: () => import('../workflows/service/workflow-run-service.types.js').WorkflowRunServiceLike | undefined;
  /** Runtime notification for UI/CLI shells that cache skill catalogs. */
  onSkillsUpdated?: (payload: { reason: 'disk' | 'config' }) => void;
  /** Install a managed skill from an explicit source and refresh runtime state. */
  installSkillFromSource?: (opts: SkillInstallToolOptions) => Promise<SkillInstallToolResult>;
  /** Dynamic workspace verification context injected into the system prompt when edits are pending. */
  getSelfVerifyPromptContext?: (sessionKey: string, agentId?: string) => string;
  /**
   * Runtime trust override. Persistent "do not trust" entries still take precedence.
   */
  isWorkspaceTrusted?: (workspaceDir: string) => boolean | null | undefined;
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
  /** Capability packs activated by explicit skills or UI entry points in this session. */
  activeCapabilities: Map<string, AgentCapabilitySessionState>;
  activeProjectContext?: string;
  activeSelfVerifyContext?: string;
  /** Declared env var names from skill_view; exec_command reads values from process.env at spawn time. */
  skillEnvPassthroughKeys: Set<string>;
}

export interface PreparedSkillTurn {
  text: string;
  activatedCapabilityNames: string[];
}


export class AgentManager implements AgentInstanceGateway {
  private agents = new Map<string, AgentInstance>();
  private config: AgentManagerConfig;
  private toolsFactory: AgentToolsFactory;

  private mergedConfig(): Config | undefined {
    const base = this.config.config;
    return base ? applyConfigOverrides(base) : undefined;
  }

  private activeCapabilityNames(inst: AgentInstance | undefined): string[] {
    return inst ? [...inst.activeCapabilities.keys()] : [];
  }

  private buildActiveCapabilityContext(
    instance: AgentInstance,
    capabilityNames: readonly string[],
    registeredToolNames: readonly string[],
  ): string | undefined {
    const availableCatalog = this.resolveCapabilityCatalogForInstance(instance, registeredToolNames)
      .filter((definition) => definition.availableTools.length > 0);
    const definitionsById = new Map(availableCatalog.map((definition) => [definition.id, definition]));
    const definitions = [...new Set(capabilityNames)]
      .map((name) => definitionsById.get(name))
      .filter((definition): definition is AgentCapabilityCatalogEntry => Boolean(definition));
    if (definitions.length === 0) return undefined;
    const rows = definitions.map((definition) => {
      const tools = definition.availableTools.join(', ');
      const hint = definition.promptHint?.trim() ? `\n  Guidance: ${definition.promptHint.trim()}` : '';
      return `- ${definition.id} (${definition.label}): ${definition.description}\n  Tools: ${tools}${hint}`;
    });
    return [
      '# Active Capability Packs',
      '',
      'These capability packs are active for the current task. Use their tools only when they directly help satisfy the user request.',
      '',
      ...rows,
    ].join('\n');
  }

  private resolveCapabilityCatalogForInstance(
    instance: AgentInstance | undefined,
    registeredToolNames: readonly string[] = instance?.registeredToolNames ?? [],
  ): AgentCapabilityCatalogEntry[] {
    return resolveAgentCapabilityCatalog({
      registeredToolNames,
      lazyToolNames: this.toolsFactory.getLazyCapabilityToolNames(),
      deniedToolNames: instance ? [...instance.effectiveProfile.tools.denied] : [],
    });
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
  private skillFilesystemWatcher: SkillFilesystemWatcher;
  private skillDiskRefreshInProgress = false;
  private skillDiskRefreshPending = false;
  private lastExplicitSkillDiskRefreshAt = 0;
  private skillsUpdatedTimer: NodeJS.Timeout | undefined;
  private pendingSkillsUpdatedReason: 'disk' | 'config' | undefined;
  private projectTrustStore = new ProjectTrustStore();

  constructor(config: AgentManagerConfig) {
    this.config = config;
    this.baseWorkspacePath = this.computeBaseWorkspacePath();
    this.skillFilesystemWatcher = new SkillFilesystemWatcher({
      onChange: (event) => {
        log.info({ changedPath: event.changedPath }, 'Skill filesystem changed; refreshing skills');
        this.refreshSkillsAfterDiskChange('watch');
      },
    });
    this.skillFilesystemWatcher.refreshPrimaryWorkspace(this.baseWorkspacePath);
    this.workspaceRuntimes = new WorkspaceRuntimeRegistry({
      getConfig: () => this.config.config!,
      bundledSkillsDir: resolveBundledSkillsDir(),
      onRuntimeCreated: (resolvedPath) => {
        this.skillFilesystemWatcher.watchWorkspace(resolvedPath);
      },
    });
    this.memoryPrefetch = new MemoryPrefetchCoordinator({
      getConfig: () => this.config.config,
      getMemoryManagerForSession: (sk) => this.getMemoryManagerForSession(sk),
      getLastAssistantContent: (sk) => this.getLastAssistantContent(sk),
    });
    this.backgroundReview = new BackgroundReviewCoordinator({
      getConfig: () => this.mergedConfig(),
      onSkillsFilesystemMutate: () => this.refreshSkillsAfterDiskChange('explicit'),
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

  private getWorkspaceRuntimeForSession(sessionKey: string | undefined): WorkspaceRuntime {
    const resolvedPath = sessionKey
      ? this.getResolvedWorkspaceForSession(sessionKey)
      : this.baseWorkspacePath;
    return this.workspaceRuntimes.getOrCreate(resolvedPath);
  }

  private getCurrentWorkspaceRuntime(): WorkspaceRuntime {
    return this.getWorkspaceRuntimeForSession(this.config.getCurrentContext?.()?.sessionKey);
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
    this.skillFilesystemWatcher.refreshPrimaryWorkspace(this.baseWorkspacePath);
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
      getMemoryManager: () => this.getCurrentWorkspaceRuntime().memoryManager,
      getSessionStore: this.config.getSessionStore,
      gatewayClarify: this.config.gatewayClarify,
      getAutomationService: this.config.getAutomationService,
      getNotesService: this.config.getNotesService,
      getProjectService: this.config.getProjectService,
      getWorkItemService: this.config.getWorkItemService,
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
        this.refreshSkillsAfterDiskChange('explicit');
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
      installSkillFromSource: this.config.installSkillFromSource,
    };
  }

  getMemoryManager(): MemoryManager {
    return this.getCurrentWorkspaceRuntime().memoryManager;
  }

  getMemoryManagerForSession(sessionKey: string): MemoryManager {
    return this.getWorkspaceRuntimeForSession(sessionKey).memoryManager;
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
   * Call once per user turn before the main embedded agent turn.
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
      workspacePath: this.getResolvedWorkspaceForSession(sessionKey),
      lastAssistantText: this.getLastAssistantContent(sessionKey),
      workspaceRuntime: this.getWorkspaceRuntimeForSession(sessionKey),
    });
  }

  /**
   * Expand `/skill:name` user text into the full skill block for the current turn (WebChat, channels).
   */
  expandSkillUserText(text: string): string {
    const ctx = this.config.getCurrentContext?.();
    const sessionKey = ctx?.sessionKey;
    const inst = sessionKey ? this.agents.get(sessionKey) : undefined;
    return this.getWorkspaceRuntimeForSession(sessionKey).skillManager.expandCommand(text, {
      skillAllowlist: inst?.effectiveProfile.skillsAllowlist,
      registeredToolNames: inst?.registeredToolNames,
    });
  }

  prepareSkillTurn(sessionKey: string, text: string): PreparedSkillTurn {
    this.getOrCreateAgent(sessionKey);
    const inst = this.agents.get(sessionKey);
    if (!text.includes('/skill:')) {
      return {
        text,
        activatedCapabilityNames: this.activeCapabilityNames(inst),
      };
    }
    const rt = this.getWorkspaceRuntimeForSession(sessionKey);
    const options = {
      skillAllowlist: inst?.effectiveProfile.skillsAllowlist,
      registeredToolNames: inst?.registeredToolNames,
    };
    const expanded = text.trimStart().startsWith('/skill:')
      ? rt.skillManager.expandCommand(text, options)
      : text;
    const selectedCapabilities = rt.skillManager.getActivatedCapabilitiesForText(text, options);
    const turnOnlyCapabilities: string[] = [];
    const now = Date.now();
    for (const capabilityName of selectedCapabilities) {
      const state = createAgentCapabilitySessionState(capabilityName, 'skill', now);
      if (!state) continue;
      if (state.ttl === 'turn') {
        turnOnlyCapabilities.push(state.id);
        continue;
      }
      inst?.activeCapabilities.set(state.id, state);
    }
    return {
      text: expanded,
      activatedCapabilityNames: [
        ...new Set([
          ...this.activeCapabilityNames(inst),
          ...turnOnlyCapabilities,
        ]),
      ],
    };
  }

  async withSkillCapabilities<T>(
    sessionKey: string,
    capabilityNames: readonly string[],
    run: () => Promise<T>,
  ): Promise<T> {
    const requested = [...new Set(capabilityNames.map((name) => name.trim()).filter(Boolean))];
    if (requested.length === 0) return run();

    this.getOrCreateAgent(sessionKey);
    const inst = this.agents.get(sessionKey);
    if (!inst) return run();

    const activatedTools = this.toolsFactory.createCapabilityTools(requested, {
      disabledTools: inst.effectiveProfile.tools.denied,
    });
    const existingNames = new Set(inst.registeredToolNames);
    const newTools = activatedTools.filter((tool) => !existingNames.has(tool.name));

    const originalTools = inst.agent.state.tools as AgentTool<any, any>[];
    const originalRegisteredToolNames = inst.registeredToolNames;
    const originalSystemPrompt = inst.agent.state.systemPrompt;
    const nextRegisteredToolNames = [...originalRegisteredToolNames, ...newTools.map((tool) => tool.name)];

    inst.agent.state.tools = newTools.length > 0 ? [...originalTools, ...newTools] : originalTools;
    inst.registeredToolNames = nextRegisteredToolNames;
    inst.agent.state.systemPrompt = this.buildSystemPromptForInstance(
      inst,
      nextRegisteredToolNames,
      requested,
    );
    try {
      return await run();
    } finally {
      inst.agent.state.tools = originalTools;
      inst.registeredToolNames = originalRegisteredToolNames;
      inst.agent.state.systemPrompt = originalSystemPrompt;
    }
  }

  private buildSystemPromptForInstance(
    instance: AgentInstance,
    registeredToolNames: string[] = instance.registeredToolNames,
    activeCapabilityNames: readonly string[] = this.activeCapabilityNames(instance),
  ): string {
    const cfg = this.config.config!;
    const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(instance.sessionKey);
    const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
    const contextFiles = this.resolveContextFilesForSession(instance.sessionKey, instance.effectiveProfile);
    const modelRef = instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel;
    const thinkingLevel =
      (instance.agent.state.thinkingLevel as ThinkingLevel | undefined) ??
      (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
      this.config.thinkingLevel ??
      'medium';
    return rt.systemPromptBuilder.build(contextFiles, {
      externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
      workspaceOverride: resolvedWorkspacePath,
      profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
      systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
      skillAllowlist: instance.effectiveProfile.skillsAllowlist,
      registeredToolNames,
      sessionKey: instance.sessionKey,
      modelRef,
      agentId: instance.effectiveProfile.agentId,
      thinkingLevel,
      activeProjectContext: this.composeDynamicProjectContext(
        instance.activeProjectContext,
        instance.activeSelfVerifyContext,
        this.buildActiveCapabilityContext(instance, activeCapabilityNames, registeredToolNames),
      ),
    });
  }

  /** Structured SKILL.md preview for the gateway console. */
  getSkillMarkdownSource(skillName: string): SkillMarkdownPreviewPayload | null {
    const skill = this.getCurrentWorkspaceRuntime().skillManager.findSkill(skillName);
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

  private isProjectWorkspaceTrusted(workspaceDir: string): boolean {
    if (!hasTrustRequiringProjectResources(workspaceDir)) {
      return false;
    }

    const persisted = this.projectTrustStore.get(workspaceDir);
    if (persisted === false) {
      return false;
    }
    if (persisted === true) {
      return true;
    }

    try {
      return this.config.isWorkspaceTrusted?.(workspaceDir) === true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, workspaceDir, errorMessage }, `Workspace trust override failed: ${errorMessage}`);
      return false;
    }
  }

  private resolveContextFilesForSession(
    sessionKey: string,
    profile: EffectiveAgentProfile,
    excludeHeartbeat?: boolean,
  ): EmbeddedContextFile[] {
    const cfg = this.config.config!;
    const profileDir = resolveAgentProfileDir(cfg, profile.agentId);
    const heartbeatEnabled = cfg.gateway?.heartbeat?.includeSystemPromptSection ?? false;
    const contextInjection = 'always';
    const { contextFiles } = resolveBootstrapContextSync({
      profileDir,
      userProfilePath: resolveUserProfilePath(),
      config: cfg,
      sessionKey,
      excludeHeartbeat: excludeHeartbeat ?? !heartbeatEnabled,
      contextInjection,
    });
    const shouldAppendProjectContext =
      contextInjection === 'always' ||
      (contextInjection === 'continuation-skip' && contextFiles.length > 0);
    const workspaceDir = this.getResolvedWorkspaceForSession(sessionKey);
    if (
      shouldAppendProjectContext &&
      this.isProjectWorkspaceTrusted(workspaceDir)
    ) {
      const projectAgentsFile = loadProjectAgentsContextFile(workspaceDir);
      if (projectAgentsFile) {
        contextFiles.push(projectAgentsFile);
      }
    }
    return contextFiles;
  }

  private skillCatalogEntryFromSkill(
    s: Skill,
    skillsConfig = createSkillConfigManager(resolveStateDir()).load(),
    lock = loadSkillsLock(),
    workspaceLock?: SkillsLockFile,
    workspaceDir?: string,
  ): SkillCatalogEntry {
    const base = resolve(s.baseDir);
    const workspaceRoot = workspaceDir ? resolveWorkspaceSkillsDir(workspaceDir) : '';
    const workspaceManaged = workspaceRoot ? s.source === 'workspace' && base.startsWith(resolve(workspaceRoot) + sep) : false;
    const globalManaged = isUnderManagedSkillsDir(s.baseDir);
    const managed = globalManaged || workspaceManaged;
    const directoryId = base.split(sep).filter(Boolean).pop() || s.name;
    const enabled = !(skillsConfig.entries?.[s.name]?.enabled === false);
    const hubKey = managed ? basename(base) : '';
    const sourceLock = workspaceManaged ? workspaceLock : lock;
    const hub = managed && hubKey ? sourceLock?.entries[hubKey] : undefined;

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
  }

  getSkillCatalog(): SkillCatalogEntry[] {
    return this.getSkillCatalogSnapshot().catalog;
  }

  getSkillCatalogSnapshot(): SkillCatalogSnapshot {
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    const lock = loadSkillsLock();
    const sessionKey = this.config.getCurrentContext?.()?.sessionKey;
    const workspaceDir = sessionKey ? this.getResolvedWorkspaceForSession(sessionKey) : this.baseWorkspacePath;
    const workspaceLock = loadSkillsLock(resolveWorkspaceSkillsLockPath(workspaceDir));
    const rt = this.getCurrentWorkspaceRuntime();
    return {
      catalog: rt.skillManager
        .getSkills()
        .map((s) => this.skillCatalogEntryFromSkill(s, skillsConfig, lock, workspaceLock, workspaceDir)),
      version: rt.skillManager.getVersion(),
      loadedAt: rt.skillManager.getLoadedAt(),
      diagnostics: rt.skillManager.getDiagnostics(),
      status: rt.skillManager.getStatus(),
    };
  }

  getAgentSkillAvailability(agentId: string): AgentSkillAvailabilityPayload {
    const cfg = this.config.config!;
    const entry = Array.isArray(cfg.agents?.list)
      ? cfg.agents.list.find((a) => a && a.enabled !== false && a.id.toLowerCase() === agentId.toLowerCase())
      : undefined;
    const profile = resolveEffectiveAgentProfile(cfg, agentId);
    const rt = this.workspaceRuntimes.getOrCreate(profile.resolvedWorkspacePath);
    const skillsConfig = createSkillConfigManager(resolveStateDir()).load();
    const lock = loadSkillsLock();
    const workspaceLock = loadSkillsLock(resolveWorkspaceSkillsLockPath(profile.resolvedWorkspacePath));
    const allow = profile.skillsAllowlist === undefined ? undefined : new Set(profile.skillsAllowlist.map((s) => s.toLowerCase()));

    const skills = rt.skillManager.getSkills().map((s) => {
      let unavailableReason: AgentSkillUnavailableReason | null = null;
      const skillConfig = resolveSkillConfig(s, skillsConfig);
      if (skillConfig.enabled === false) {
        unavailableReason = 'disabled';
      } else if (s.disableModelInvocation) {
        unavailableReason = 'model-invocation-disabled';
      } else if (!isSkillEnabled(s, skillsConfig)) {
        unavailableReason = 'requirements-unmet';
      } else if (allow !== undefined && !allow.has(s.name.toLowerCase())) {
        unavailableReason = 'agent-denied';
      }

      return {
        ...this.skillCatalogEntryFromSkill(
          s,
          skillsConfig,
          lock,
          workspaceLock,
          profile.resolvedWorkspacePath,
        ),
        availableForCurrentAgent: unavailableReason === null,
        unavailableReason,
      };
    });

    return {
      agentId: profile.agentId,
      version: rt.skillManager.getVersion(),
      loadedAt: rt.skillManager.getLoadedAt(),
      diagnostics: rt.skillManager.getDiagnostics(),
      status: rt.skillManager.getStatus(),
      ...(entry?.skills.mode === 'allowlist' ? { agentAllowlist: [...(entry.skills.allow ?? [])] } : {}),
      ...(profile.skillsAllowlist !== undefined ? { effectiveAllowlist: [...profile.skillsAllowlist] } : {}),
      skills,
    };
  }

  /**
   * After ~/.xopc/skills.json changes (enable/disable), refresh `<available_skills>` on active agents.
   */
  refreshSkillsAfterSkillConfigChange(): void {
    const cfg = this.config.config!;
    const touched = new Set<string>();
    for (const [resolvedPath, rt] of this.workspaceRuntimes.entries()) {
      rt.skillManager.refreshPromptFromConfig();
      touched.add(resolvedPath);
    }
    for (const instance of this.agents.values()) {
      const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(instance.sessionKey);
      const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
      if (!touched.has(resolvedWorkspacePath)) {
        rt.skillManager.refreshPromptFromConfig();
        touched.add(resolvedWorkspacePath);
      }
      const contextFiles = this.resolveContextFilesForSession(
        instance.sessionKey,
        instance.effectiveProfile,
      );
      instance.activeProjectContext = buildActiveProjectContextForPrompt(instance.sessionKey);
      instance.activeSelfVerifyContext = this.getSelfVerifyPromptContext(
        instance.sessionKey,
        instance.effectiveProfile.agentId,
      );
      const newPrompt = rt.systemPromptBuilder.build(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: resolvedWorkspacePath,
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
        activeProjectContext: this.composeDynamicProjectContext(
          instance.activeProjectContext,
          instance.activeSelfVerifyContext,
        ),
      });
      instance.agent.state.systemPrompt = newPrompt;
    }
    log.info({ agents: this.agents.size }, 'Skill toggles applied; system prompt updated');
    this.scheduleSkillsUpdated('config');
  }

  /**
   * Reload skills from disk and refresh system prompt on all active Agent instances.
   */
  refreshSkillsAfterDiskChange(source: 'explicit' | 'watch' = 'explicit'): void {
    const now = Date.now();
    if (source === 'watch' && now - this.lastExplicitSkillDiskRefreshAt < 2500) {
      log.debug({ changedWithinMs: now - this.lastExplicitSkillDiskRefreshAt }, 'Ignoring skill watcher echo after explicit refresh');
      return;
    }
    if (source === 'explicit') {
      this.lastExplicitSkillDiskRefreshAt = now;
    }

    if (this.skillDiskRefreshInProgress) {
      this.skillDiskRefreshPending = true;
      return;
    }

    this.skillDiskRefreshInProgress = true;
    let refreshed = false;
    try {
      do {
        this.skillDiskRefreshPending = false;
        this.applySkillsAfterDiskChange();
        refreshed = true;
      } while (this.skillDiskRefreshPending);
    } finally {
      this.skillDiskRefreshInProgress = false;
    }

    if (refreshed) {
      this.scheduleSkillsUpdated('disk');
    }
  }

  private scheduleSkillsUpdated(reason: 'disk' | 'config'): void {
    this.pendingSkillsUpdatedReason = reason === 'disk' ? 'disk' : this.pendingSkillsUpdatedReason ?? 'config';
    if (this.skillsUpdatedTimer) clearTimeout(this.skillsUpdatedTimer);
    this.skillsUpdatedTimer = setTimeout(() => {
      const nextReason = this.pendingSkillsUpdatedReason ?? reason;
      this.pendingSkillsUpdatedReason = undefined;
      this.skillsUpdatedTimer = undefined;
      this.config.onSkillsUpdated?.({ reason: nextReason });
    }, 250);
  }

  private applySkillsAfterDiskChange(): void {
    const cfg = this.config.config!;
    // Reload every workspace SkillManager first. When there are no active agent sessions
    // (e.g. gateway UI only), the loop below runs zero times — without this, `getSkillCatalog()`
    // and delete flows still see stale in-memory skills after ~/.xopc/skills changes.
    for (const rt of this.workspaceRuntimes.values()) {
      rt.skillManager.reload();
    }

    const touched = new Set<string>();
    for (const instance of this.agents.values()) {
      const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(instance.sessionKey);
      const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
      if (!touched.has(resolvedWorkspacePath)) {
        touched.add(resolvedWorkspacePath);
      }
      const contextFiles = this.resolveContextFilesForSession(
        instance.sessionKey,
        instance.effectiveProfile,
      );
      instance.activeProjectContext = buildActiveProjectContextForPrompt(instance.sessionKey);
      instance.activeSelfVerifyContext = this.getSelfVerifyPromptContext(
        instance.sessionKey,
        instance.effectiveProfile.agentId,
      );
      const newPrompt = rt.systemPromptBuilder.rebuild(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: resolvedWorkspacePath,
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
        activeProjectContext: this.composeDynamicProjectContext(
          instance.activeProjectContext,
          instance.activeSelfVerifyContext,
        ),
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
        this.refreshActiveProjectContextIfChanged(existing);
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
        .initializeAll(sessionKey, { workspace: resolvedPath, agentId: profile.agentId })
        .catch((err) => log.warn({ err, sessionKey }, 'memory initializeAll failed'));
    }

    if (isMemorySubsystemEnabled(cfg) && shouldRegisterCuratedMemoryTool(cfg)) {
      rt.builtinMemoryStore.loadFromDiskSync();
    }

    const activeProjectContext = buildActiveProjectContextForPrompt(sessionKey);
    const activeSelfVerifyContext = this.getSelfVerifyPromptContext(sessionKey, profile.agentId);
    const { agent, registeredToolNames } = this.createAgentForProfile(
      sessionKey,
      profile,
      resolvedPath,
      rt,
      activeProjectContext,
      activeSelfVerifyContext,
    );

    this.agents.set(sessionKey, {
      agent,
      sessionKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      effectiveProfile: profile,
      resolvedWorkspacePath: resolvedPath,
      registeredToolNames,
      activeCapabilities: new Map<string, AgentCapabilitySessionState>(),
      activeProjectContext,
      activeSelfVerifyContext,
      skillEnvPassthroughKeys: new Set<string>(),
    });

    this.backgroundReview.attachToAgent(sessionKey, agent, registeredToolNames);

    const modelRef = profile.primaryModelRef?.trim() || this.defaultModel;
    this.config.getModelManager?.().setSessionProfileDefault(sessionKey, modelRef, profile.fallbacks);

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
    const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(sessionKey);
    const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
    const contextFiles = this.resolveContextFilesForSession(sessionKey, instance.effectiveProfile);
    const modelRef = instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel;
    const thinkingLevel =
      (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
      this.config.thinkingLevel ??
      'medium';

    const activeProjectContext = buildActiveProjectContextForPrompt(sessionKey);
    const activeSelfVerifyContext = this.getSelfVerifyPromptContext(
      sessionKey,
      instance.effectiveProfile.agentId,
    );
    instance.agent.state.systemPrompt = rt.systemPromptBuilder.build(contextFiles, {
      externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
      workspaceOverride: resolvedWorkspacePath,
      profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
      systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
      skillAllowlist: instance.effectiveProfile.skillsAllowlist,
      registeredToolNames: instance.registeredToolNames,
      sessionKey,
      modelRef,
      agentId: instance.effectiveProfile.agentId,
      thinkingLevel,
      extraSystemPrompt: trimmed,
      activeProjectContext: this.composeDynamicProjectContext(
        activeProjectContext,
        activeSelfVerifyContext,
      ),
    });
    instance.activeProjectContext = activeProjectContext;
    instance.activeSelfVerifyContext = activeSelfVerifyContext;
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
    if (this.skillsUpdatedTimer) clearTimeout(this.skillsUpdatedTimer);
    this.skillFilesystemWatcher.dispose();
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

  private getSelfVerifyPromptContext(sessionKey: string, agentId?: string): string {
    return this.config.getSelfVerifyPromptContext?.(sessionKey, agentId).trim() ?? '';
  }

  private composeDynamicProjectContext(...sections: Array<string | undefined>): string | undefined {
    return sections.map((section) => section?.trim())
      .filter((section): section is string => Boolean(section))
      .join('\n\n') || undefined;
  }

  getCapabilityCatalogForSession(sessionKey?: string): AgentCapabilityCatalogEntry[] {
    const inst = sessionKey?.trim() ? this.agents.get(sessionKey.trim()) : undefined;
    return this.resolveCapabilityCatalogForInstance(inst);
  }

  private createAgentForProfile(
    sessionKey: string,
    profile: EffectiveAgentProfile,
    resolvedWorkspacePath: string,
    rt: WorkspaceRuntime,
    activeProjectContext?: string,
    activeSelfVerifyContext?: string,
  ): { agent: Agent; registeredToolNames: string[] } {
    const modelRef = profile.primaryModelRef?.trim() || this.defaultModel;
    const model = this.resolveModelStringToModel(modelRef);

    const contextFiles = this.resolveContextFilesForSession(sessionKey, profile);
    const dreamingRoot = join(resolveAgentHomeDir(this.config.config!, profile.agentId), 'memories');
    const tools = this.toolsFactory.createAllTools({
      workspace: resolvedWorkspacePath,
      profileMarkdownRoot: resolveAgentProfileDir(this.config.config!, profile.agentId),
      agentId: profile.agentId,
      dreamingRoot,
      disabledTools: profile.tools.denied,
      getPrimaryModel: () => this.resolveModelStringToModel(modelRef),
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
          activeProjectContext: this.composeDynamicProjectContext(
            activeProjectContext,
            activeSelfVerifyContext,
          ),
        }),
        model,
        thinkingLevel,
        tools,
        messages: [],
      },
      toolExecution: 'parallel',
      streamFn: createExtensionAwareStreamFn(),
      getApiKey: (provider: string) => this.resolveApiKeyWithCache(provider),
      beforeToolCall: async ({ toolCall, args }) => {
        const toolName = toolCall.name;

        if (toolName === 'exec_command') {
          const ctx = this.config.getCurrentContext();
          const cfg = this.mergedConfig();
          if (ctx && cfg) {
            const command =
              typeof (args as { cmd?: unknown })?.cmd === 'string'
                ? (args as { cmd: string }).cmd
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

  private refreshActiveProjectContextIfChanged(instance: AgentInstance): void {
    const nextProjectContext = buildActiveProjectContextForPrompt(instance.sessionKey);
    const nextSelfVerifyContext = this.getSelfVerifyPromptContext(
      instance.sessionKey,
      instance.effectiveProfile.agentId,
    );
    if (
      nextProjectContext === instance.activeProjectContext &&
      nextSelfVerifyContext === (instance.activeSelfVerifyContext ?? '')
    ) {
      return;
    }
    const cfg = this.config.config!;
    const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(instance.sessionKey);
    const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
    const contextFiles = this.resolveContextFilesForSession(instance.sessionKey, instance.effectiveProfile);
    const modelRef = instance.effectiveProfile.primaryModelRef?.trim() || this.defaultModel;
    const thinkingLevel =
      (instance.agent.state.thinkingLevel as ThinkingLevel | undefined) ??
      (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
      this.config.thinkingLevel ??
      'medium';
    instance.agent.state.systemPrompt = rt.systemPromptBuilder.build(contextFiles, {
      externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
      workspaceOverride: resolvedWorkspacePath,
      profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
      systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
      skillAllowlist: instance.effectiveProfile.skillsAllowlist,
      registeredToolNames: instance.registeredToolNames,
      sessionKey: instance.sessionKey,
      modelRef,
      agentId: instance.effectiveProfile.agentId,
      thinkingLevel,
      activeProjectContext: this.composeDynamicProjectContext(
        nextProjectContext,
        nextSelfVerifyContext,
      ),
    });
    instance.activeProjectContext = nextProjectContext;
    instance.activeSelfVerifyContext = nextSelfVerifyContext;
    log.debug({ sessionKey: instance.sessionKey }, 'Dynamic agent context changed; system prompt refreshed');
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
      const resolvedWorkspacePath = this.getResolvedWorkspaceForSession(sessionKey);
      const rt = this.workspaceRuntimes.getOrCreate(resolvedWorkspacePath);
      const contextFiles = this.resolveContextFilesForSession(
        sessionKey,
        instance.effectiveProfile,
      );
      const thinkingLevel =
        (instance.agent.state.thinkingLevel as ThinkingLevel | undefined) ??
        (instance.effectiveProfile.thinkingDefault as ThinkingLevel | undefined) ??
        this.config.thinkingLevel ??
        'medium';

      const activeProjectContext = buildActiveProjectContextForPrompt(sessionKey);
      const activeSelfVerifyContext = this.getSelfVerifyPromptContext(
        sessionKey,
        instance.effectiveProfile.agentId,
      );
      instance.agent.state.systemPrompt = rt.systemPromptBuilder.build(contextFiles, {
        externalMemoryInstructions: rt.memoryManager.buildExternalSystemPrompt(),
        workspaceOverride: resolvedWorkspacePath,
        profileMarkdownPathRoot: resolveAgentProfileDir(cfg, instance.effectiveProfile.agentId),
        systemPromptOverride: instance.effectiveProfile.systemPromptOverride,
        skillAllowlist: instance.effectiveProfile.skillsAllowlist,
        registeredToolNames: instance.registeredToolNames,
        sessionKey,
        modelRef: modelId,
        agentId: instance.effectiveProfile.agentId,
        thinkingLevel,
        activeProjectContext: this.composeDynamicProjectContext(
          activeProjectContext,
          activeSelfVerifyContext,
        ),
      });
      instance.activeProjectContext = activeProjectContext;
      instance.activeSelfVerifyContext = activeSelfVerifyContext;

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

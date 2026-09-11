/**
 * Agent Tools Factory - Creates and configures agent tools
 *
 * Centralizes tool creation logic to keep service.ts focused on orchestration.
 *
 * TTS: auto TTS is applied at the ChannelManager via maybeApplyTtsToPayload().
 * Optional \`text_to_speech\` tool sends explicit voice when TTS is enabled.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import type { Config } from '../../config/schema.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';
import type { ExtensionRegistry } from '../../extensions/types/index.js';
import { resolveDefaultAgentId } from '../agent-scope.js';
import {
  getEmbeddedExecutionRunId,
  getEmbeddedExecutionSession,
} from '../embedded/execution-context.js';
import {
  createDefaultExternalToolGatewayTools,
  EXTERNAL_TOOL_NAMES,
} from '../external-tools/index.js';
import type { MessageBus } from '../../infra/bus/index.js';
import {
  createReadFileTool,
  createWriteFileTool,
  createApplyPatchTool,
  createListDirTool,
  createGrepTool,
  createFindTool,
  createExecCommandTool,
  createManagedJobTool,
  createWebSearchTool,
  createWebFetchTool,
  createWebExtractTool,
  createMessageTool,
  createSendMediaTool,
  createPublishArtifactsTool,
  createReadMediaTool,
  createCreateShareTool,
  isShareToolAvailable,
  createUserContextSearchTool,
  createUserContextGetTool,
  createUserContextUpdateTool,
  createKnowledgeSearchTool,
  createKnowledgeGetTool,
  createKnowledgeWriteTool,
  createSessionRecallTool,
  createTodoTool,
  createUpdatePlanTool,
  createSessionStatusTool,
  createMemoryMaintenanceTool,
  createClarifyTool,
  createToolManualTool,
  createAutomationTool,
  createBrowserAutomationTool,
  createXopcUseTool,
  createDesktopPetTool,
  createSkillInstallTool,
  createSkillsMarketplaceSearchTool,
  type SkillInstallToolOptions,
  type SkillInstallToolResult,
  type MarketplaceSkillInstallToolOptions,
  type MarketplaceSkillInstallToolResult,
} from './index.js';
import { createSessionSearchTool } from './session-search-tool.js';
import { getPendingTranscriptUserText } from '../inbound/attachment-pipeline.js';
import type { MemoryManager } from '../memory/manager.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import type { SessionStore } from '../../session/store.js';
import type { GatewayClarifyRequestFn } from './clarify-tool.js';
import { createImageTool } from './image-tool.js';
import { createImageGenerateTool } from './image-generate-tool.js';
import { BrowserNotReadyError, checkBrowserReadiness } from '../../browser/index.js';
import { createBrowserDriver } from '../../browser/drivers/create-driver.js';
import { BrowserRuntime } from '../../browser/runtime/browser-runtime.js';
import { getBrowserTabBinding } from '../../storage/sqlite/browser-tab-binding-repository.js';
import { createBrowserUseTool } from './browser/tool/browser-use-tool.js';
import { createReviewWorkspaceTool } from './review-workspace.js';
import { createLanguageDiagnosticsTool } from './language-diagnostics.js';
import { createDelegateTool } from './delegate-tool.js';
import { createWorkflowTool } from './workflow-tool.js';
import { createWorkflowCatalog } from '../workflow/catalog.js';
import type { AutomationService } from '../../automations/index.js';
import type { BrowserAutomationService } from '../../browser/automations/index.js';
import type { NotesService } from '../../notes/index.js';
import type { ProjectService } from '../../projects/index.js';
import type { LocalAppService } from '../../local-apps/index.js';
import type { WorkflowRunServiceLike } from '../../workflows/service/workflow-run-service.types.js';
import { createLogger } from '../../utils/logger.js';
import { skillEnvironmentId } from '../skills/installer.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { wrapToolsWithProtection, type ToolExecutorConfig } from './executor.js';
import { createSkillsListTool, createSkillViewTool } from './skills-tools.js';
import { createSkillManageTool } from './skill-manage-tool.js';
import { createTextToSpeechTool } from './tts-tool.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { getAgentCapabilityToolNames } from '../capabilities/index.js';
import { sortToolsForPromptCache } from './cache-stability.js';
import {
  getSessionMetadata,
  getSessionTaskPlan,
  isXopcDatabaseOpen,
  setSessionTaskPlan,
} from '../../storage/sqlite/index.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { buildRuntimeEnvironment } from '../../runtime-tools/environment.js';

const log = createLogger('AgentToolsFactory');

/** Channels where `clarify` can block for a user answer (web UI, Telegram, CLI readline). */
const CLARIFY_SUPPORTED_CHANNELS = new Set(['webchat', 'telegram', 'cli']);

export interface ToolFactoryDeps {
  workspace: string;
  extensionRegistry?: ExtensionRegistry;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string; origin: TurnOrigin } | null;
  endpointTools?: EndpointToolRuntime;
  hookRunner?: import('../../extensions/index.js').ExtensionHookRunner;
  bus: MessageBus;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /** Agent defaults (image tools, etc.); use getter so hot-reloaded config applies. */
  getConfig?: () => Config | undefined;
  /** Session / default chat model for vision tool description. */
  getPrimaryModel?: () => Model<Api>;
  /** Memory orchestration (prefetch/sync + external tools). */
  getMemoryManager?: () => MemoryManager;
  /** Skill runtime for the current workspace/session. */
  getSkillManager?: () => SkillManager;
  /** Session store for `session_search`. */
  getSessionStore?: () => SessionStore;
  /** When set (gateway webchat), enables the `clarify` tool. */
  gatewayClarify?: { requestClarification: GatewayClarifyRequestFn };
  /** Gateway: enables the `automation` tool. */
  getAutomationService?: () => AutomationService | undefined;
  getBrowserAutomationService?: () => BrowserAutomationService | undefined;
  emitBrowserEvent?: (type: string, payload: unknown) => void;
  /** Gateway: enables the `xopc_use` product-object tool. */
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getLocalAppService?: () => LocalAppService | undefined;
  /** Gateway: publishes durable Task change notifications. */
  dispatchTaskEvents?: () => void;
  /** Gateway: queues Task execution for xopc_use task start/resume/verify actions. */
  dispatchTaskRuns?: () => void;
  /** Gateway: starts persisted workflow runs (dedicated chat session per run). */
  getWorkflowRunService?: () => WorkflowRunServiceLike | undefined;
  /** Current session skill indexing (tool gating + allowlist); used by skills_list / skill_view. */
  getSkillIndexingContext?: () =>
    | { registeredToolNames: string[]; skillAllowlist?: string[] }
    | undefined;
  /** After skill_manage mutates disk, reload skills + refresh agent prompts (optional). */
  onSkillsFilesystemMutate?: () => void;
  /** Names registered via skill_view for command env passthrough. */
  getSkillPassthroughEnvVarNames?: () => string[];
  /** Add declared env names for the current session (no values stored). */
  registerSkillEnvPassthrough?: (names: string[]) => void;
  /** Install managed skills from explicit sources when a capability/tool enables it. */
  installSkillFromSource?: (opts: SkillInstallToolOptions) => Promise<SkillInstallToolResult>;
  /** Install a managed skill from a built-in marketplace provider. */
  installSkillFromMarketplace?: (
    opts: MarketplaceSkillInstallToolOptions,
  ) => Promise<MarketplaceSkillInstallToolResult>;
}

export interface CreateCoreToolsOptions {
  /** Workspace root for file/command tools (defaults to factory workspace). */
  workspace?: string;
  /** Canonical `agents/<id>/profile/`: bare SOUL.md / IDENTITY.md resolve here after the workspace. */
  profileMarkdownRoot?: string;
  /** Tool `name` values to omit (e.g. `exec_command`, `extensions` for extension tools). */
  disabledTools?: Set<string>;
  /** Optional primary model for image tool heuristics. */
  getPrimaryModel?: () => Model<Api>;
  getMemoryManager?: () => MemoryManager;
  agentId?: string;
  sessionKey?: string;
  /** When set, registers local skill tools plus marketplace discovery for this workspace. */
  getSkillManager?: () => SkillManager;
}

export class AgentToolsFactory {
  private browserRuntime: BrowserRuntime | null = null;
  /** Cached readiness probe keyed by the active driver configuration. */
  private browserReadinessCache: {
    key: string;
    expiresAt: number;
    inflight?: Promise<BrowserNotReadyError | null>;
    result?: BrowserNotReadyError | null;
  } | null = null;

  constructor(private deps: ToolFactoryDeps) {}

  private prepareRuntimeEnv = async (baseEnv: Record<string, string>): Promise<Record<string, string>> => {
    const config = this.deps.getConfig?.();
    if (!config) return baseEnv;
    const indexing = this.deps.getSkillIndexingContext?.();
    const skillEnvironmentIds = this.deps.getSkillManager?.()
      ?.getEnabledSkillsForAgentSession(indexing)
      .flatMap((skill) => (
        skill.metadata.install ?? []
      ).map((installSpec) => skillEnvironmentId(skill, installSpec)));
    return (await buildRuntimeEnvironment({
      stateDir: resolveStateDir(),
      config: config.runtimeTools,
      baseEnv,
      skillEnvironmentIds,
    })).env;
  };

  private browserReadinessKey(): string {
    return JSON.stringify(this.deps.getConfig?.()?.browser.driver ?? null);
  }

  private async checkBrowserReadinessCached(): Promise<BrowserNotReadyError | null> {
    const key = this.browserReadinessKey();
    const now = Date.now();
    const cached = this.browserReadinessCache;
    if (cached && cached.key === key && cached.expiresAt > now && cached.inflight === undefined) {
      return cached.result ?? null;
    }
    if (cached && cached.key === key && cached.inflight) {
      return cached.inflight;
    }
    const inflight = checkBrowserReadiness(this.deps.getConfig?.());
    this.browserReadinessCache = { key, expiresAt: now + 30_000, inflight };
    try {
      const result = await inflight;
      this.browserReadinessCache = { key, expiresAt: Date.now() + 30_000, result };
      return result;
    } catch (e) {
      // Probe should never throw, but if it does we just bypass the cache.
      this.browserReadinessCache = null;
      log.warn({ err: e }, 'browserReadiness probe failed');
      return null;
    }
  }

  /** Invalidate the readiness cache (config hot-reload, settings-page save, etc.). */
  invalidateBrowserReadinessCache(): void {
    this.browserReadinessCache = null;
  }

  private ensureBrowserRuntime(): BrowserRuntime {
    if (!this.browserRuntime) {
      this.browserRuntime = new BrowserRuntime({
        getConfig: () => {
          const config = this.deps.getConfig?.();
          if (!config) throw new Error('Browser configuration is unavailable');
          return config.browser;
        },
        createDriver: async () => {
          const config = this.deps.getConfig?.();
          if (!config) throw new Error('Browser configuration is unavailable');
          return createBrowserDriver(config.browser);
        },
        allowedUploadRoots: [this.deps.workspace],
        emit: this.deps.emitBrowserEvent,
        resolveTarget: (sessionKey) => {
          const binding = getBrowserTabBinding(sessionKey);
          return binding ? { kind: 'attached_tab', bindingId: binding.id } : undefined;
        },
      });
    }
    return this.browserRuntime;
  }

  /** Close Playwright and all pages (gateway stop, agent manager dispose, or config hot-reload). */
  async shutdownBrowser(): Promise<void> {
    this.browserReadinessCache = null;
    if (!this.browserRuntime) {
      return;
    }
    await this.browserRuntime.shutdown();
    this.browserRuntime = null;
  }

  /** Drop the tab for a session when its agent instance is removed. */
  async closeBrowserPageForSession(sessionKey: string): Promise<void> {
    await this.browserRuntime?.closeTaskSession(sessionKey);
  }

  createCoreTools(options?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const workspace = options?.workspace ?? this.deps.workspace;
    const { bus } = this.deps;
    const getPrimary = options?.getPrimaryModel ?? this.deps.getPrimaryModel;
    const getMemMgr = options?.getMemoryManager ?? this.deps.getMemoryManager;
    const getSkillMgr = options?.getSkillManager;
    const disabled = options?.disabledTools;

    const primary = getPrimary?.();
    const modelHasVision = primary?.input?.includes('image') ?? false;
    const cfg = this.deps.getConfig?.();
    const browserEnabled = cfg?.browser?.enabled !== false;
    const imageTool = createImageTool({
      config: cfg,
      workspace,
      modelHasVision,
      agentId: options?.agentId,
    });
    const imageGenerateTool = createImageGenerateTool({
      config: cfg,
      workspace,
      agentId: options?.agentId ?? (cfg ? resolveDefaultAgentId(cfg) : 'main'),
    });
    const agentId = options?.agentId;
    const resolvedAgentId = agentId ?? (cfg ? resolveDefaultAgentId(cfg) : 'main');
    const currentSessionKey = () => options?.sessionKey ?? this.deps.getCurrentContext?.()?.sessionKey;
    const currentAccess = () => resolveUserContextSessionAccess(this.deps.getConfig?.(), currentSessionKey());
    const knowledgeWritePolicy = () => this.deps.getConfig?.()?.userContext.knowledgeMemory.writePolicy ?? 'deny';
    const currentProjectId = () => {
      const key = currentSessionKey();
      return key ? getSessionMetadata(key)?.projectId : undefined;
    };
    const getCommandIsolation = () => {
      const config = this.deps.getConfig?.();
      return config ? resolveEffectiveAgentConfigForSession(config, this.deps.getCurrentContext()?.sessionKey ?? `agent:${agentId ?? 'main'}:internal`).config.runtime.commandIsolation : undefined;
    };

    const externalTools = createDefaultExternalToolGatewayTools({
      workspace,
      getConfig: () => this.deps.getConfig?.(),
      getCurrentContext: this.deps.getCurrentContext,
      endpointTools: this.deps.endpointTools,
      agentId,
      extensionRegistry: this.deps.extensionRegistry,
      disabledTools: disabled,
      hookRunner: this.deps.hookRunner,
      toolExecutorConfig: this.deps.toolExecutorConfig,
      getMemoryManager: getMemMgr,
      canAccessMemory: () => currentAccess().knowledge,
    });
    const optionalTools = [imageTool, imageGenerateTool].filter((t) => t != null) as any[];

    const readTool = createReadFileTool(workspace, {
      profileMarkdownRoot: options?.profileMarkdownRoot,
    });
    const writeTool = createWriteFileTool(workspace, {
      profileMarkdownRoot: options?.profileMarkdownRoot,
    });
    const applyPatchTool = createApplyPatchTool(workspace);
    const listDir = createListDirTool(workspace);
    const grep = createGrepTool(workspace);
    const find = createFindTool(workspace);

    const core: AgentTool<any, any>[] = [
      createSessionStatusTool(),
      createMemoryMaintenanceTool({
        getConfig: () => this.deps.getConfig?.(),
      }),
      createToolManualTool(),
      createClarifyTool({
        resolveAskUser: (toolCallId) => {
          const req = this.deps.gatewayClarify?.requestClarification;
          if (!req) return null;
          const executionSession = getEmbeddedExecutionSession();
          const runId = getEmbeddedExecutionRunId();
          if (executionSession && runId) {
            return (request) => req({ sessionKey: executionSession, runId, toolCallId }, request);
          }
          const ctx = this.deps.getCurrentContext();
          if (!ctx?.sessionKey) return null;
          if (!CLARIFY_SUPPORTED_CHANNELS.has(ctx.channel)) return null;
          if (!runId) return null;
          return (request) => req({ sessionKey: ctx.sessionKey, runId, toolCallId }, request);
        },
      }),
      createTodoTool({
        getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
        repository: {
          isAvailable: isXopcDatabaseOpen,
          read: (sessionKey) => getSessionTaskPlan(sessionKey)?.items ?? [],
          write: (sessionKey, items) => {
            setSessionTaskPlan({ sessionKey, items });
          },
        },
      }),
      createUpdatePlanTool(),
      ...externalTools,
      ...(getSkillMgr
        ? [
            createSkillsListTool({
              getSkillManager: getSkillMgr,
              getSkillIndexingContext: this.deps.getSkillIndexingContext,
            }),
            createSkillViewTool({
              getSkillManager: getSkillMgr,
              getSkillIndexingContext: this.deps.getSkillIndexingContext,
              registerSkillEnvPassthrough: this.deps.registerSkillEnvPassthrough,
            }),
            createSkillManageTool({
              getSkillManager: getSkillMgr,
              getWorkspace: () => workspace,
              onSkillsFilesystemMutate: this.deps.onSkillsFilesystemMutate,
            }),
          ]
        : []),
      createSkillsMarketplaceSearchTool({
        getConfig: () => this.deps.getConfig?.(),
        getSkillManager: getSkillMgr,
      }),
      ...(this.deps.installSkillFromSource || this.deps.installSkillFromMarketplace
        ? [createSkillInstallTool({
            installSkillFromSource: this.deps.installSkillFromSource,
            installSkillFromMarketplace: this.deps.installSkillFromMarketplace,
            getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
          })]
        : []),
      readTool,
      writeTool,
      applyPatchTool,
      listDir,
      grep,
      find,
      createExecCommandTool(workspace, {
        getCommandIsolation,
        getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
        getSkillPassthroughEnvVarNames: this.deps.getSkillPassthroughEnvVarNames,
        prepareEnv: this.prepareRuntimeEnv,
      }),
      createReviewWorkspaceTool(workspace),
      createLanguageDiagnosticsTool(workspace, { getCommandIsolation, getSessionKey: () => this.deps.getCurrentContext()?.sessionKey, prepareEnv: this.prepareRuntimeEnv }),
      createManagedJobTool(
        workspace,
        () => this.deps.getCurrentContext()?.sessionKey,
        this.deps.getSkillPassthroughEnvVarNames,
        this.prepareRuntimeEnv,
        getCommandIsolation,
      ),
      createWebSearchTool(() => this.deps.getConfig?.()),
      createWebFetchTool(() => this.deps.getConfig?.()),
      createWebExtractTool({ getConfig: () => this.deps.getConfig?.() }),
      // Note: TTS is NOT handled by send_message tool anymore
      // TTS is applied at the ChannelManager dispatch layer
      createMessageTool(bus, () => this.deps.getCurrentContext()),
      ...(mergeTtsConfigFromAppConfig(cfg?.messages?.tts).enabled
        ? [
            createTextToSpeechTool({
              bus,
              getContext: () => this.deps.getCurrentContext(),
              getConfig: () => this.deps.getConfig?.(),
            }),
          ]
        : []),
      createSendMediaTool(workspace, bus, () => this.deps.getCurrentContext()),
      createPublishArtifactsTool(workspace),
      createReadMediaTool(),
      ...(isShareToolAvailable(cfg)
        ? [
            createCreateShareTool({
              workspace,
              getConfig: () => this.deps.getConfig?.(),
            }),
          ]
        : []),
      createUserContextSearchTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
      }),
      createUserContextGetTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
      }),
      createUserContextUpdateTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
        canWrite: () => currentAccess().userModel,
        getCurrentUserText: () => {
          const sessionKey = currentSessionKey();
          return sessionKey ? getPendingTranscriptUserText(sessionKey) : undefined;
        },
      }),
      createKnowledgeSearchTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().knowledge,
        canWrite: () => currentAccess().knowledge,
        getWritePolicy: knowledgeWritePolicy,
        getSources: () => currentAccess().knowledgeSources,
      }),
      createKnowledgeGetTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().knowledge,
        canWrite: () => currentAccess().knowledge,
        getWritePolicy: knowledgeWritePolicy,
        getSources: () => currentAccess().knowledgeSources,
      }),
      createKnowledgeWriteTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentSessionKey,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().knowledge,
        canWrite: () => currentAccess().knowledge,
        getWritePolicy: knowledgeWritePolicy,
        getSources: () => currentAccess().knowledgeSources,
      }),
      ...(this.deps.getSessionStore
        ? [
            createSessionRecallTool({
              getSessionStore: this.deps.getSessionStore,
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
            }),
          ]
        : []),
      ...(this.deps.getSessionStore && getPrimary
        ? [
            createSessionSearchTool({
              getSessionStore: this.deps.getSessionStore,
              getPrimaryModel: getPrimary,
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
              canAccess: () => currentAccess().crossSessionHistory,
            }),
          ]
        : []),
      ...(this.deps.getAutomationService
        ? [
            createAutomationTool({
              getAutomationService: this.deps.getAutomationService,
            }),
          ]
        : []),
      ...(browserEnabled && this.deps.getBrowserAutomationService
        ? [createBrowserAutomationTool({ getBrowserAutomationService: this.deps.getBrowserAutomationService })]
        : []),
      ...(this.deps.getAutomationService
        || this.deps.getProjectService
        || this.deps.getNotesService
        || this.deps.getLocalAppService
        || this.deps.dispatchTaskEvents
        || this.deps.dispatchTaskRuns
        ? [
            createXopcUseTool({
              getConfig: () => this.deps.getConfig?.(),
              getCurrentAgentId: () => options.agentId,
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
              getAutomationService: this.deps.getAutomationService,
              getNotesService: this.deps.getNotesService,
              getProjectService: this.deps.getProjectService,
              getLocalAppService: this.deps.getLocalAppService,
              dispatchTaskEvents: this.deps.dispatchTaskEvents,
              dispatchTaskRuns: this.deps.dispatchTaskRuns,
            }),
          ]
        : []),
      ...(browserEnabled
        ? [
            createBrowserUseTool({
              getRuntime: () => this.ensureBrowserRuntime(),
              getTaskId: () => this.deps.getCurrentContext()?.sessionKey ?? 'default',
              getReadiness: () => this.checkBrowserReadinessCached(),
            }),
          ]
        : []),
      ...(primary
        ? [
            createWorkflowTool({
              catalog: createWorkflowCatalog(),
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
              getConfig: () => this.deps.getConfig?.(),
              startWorkflowRun: this.deps.getWorkflowRunService
                ? (params) => this.deps.getWorkflowRunService!().startWorkflowRun(params)
                : undefined,
            }),
          ]
        : []),
      ...(primary
        ? [
            createDelegateTool({
              workspace,
              getSubagentModel: () => {
                const gp = options?.getPrimaryModel ?? this.deps.getPrimaryModel;
                const m = gp?.();
                if (!m) {
                  throw new Error('No primary model configured for delegate_task');
                }
                return m;
              },
              bus: this.deps.bus,
              getConfig: () => this.deps.getConfig?.(),
              getCurrentContext: () => this.deps.getCurrentContext?.() ?? null,
              toolExecutorConfig: this.deps.toolExecutorConfig,
              // Injected so `child-agent-factory.ts` does not need to import
              // `AgentToolsFactory` directly (which would form a cycle).
              buildChildTools: (childOpts) => {
                const childFactory = new AgentToolsFactory({
                  workspace: childOpts.workspace,
                  bus: childOpts.bus,
                  getCurrentContext: () => null,
                  getConfig: childOpts.getConfig,
                  getPrimaryModel: () => childOpts.model,
                  toolExecutorConfig: childOpts.toolExecutorConfig,
                });
                return childFactory.createAllTools({
                  workspace: childOpts.workspace,
                  getPrimaryModel: () => childOpts.model,
                  agentId: options?.agentId ?? childOpts.agentId,
                  disabledTools: new Set([
                    EXTERNAL_TOOL_NAMES.search,
                    EXTERNAL_TOOL_NAMES.describe,
                    EXTERNAL_TOOL_NAMES.execute,
                    EXTERNAL_TOOL_NAMES.requireConnection,
                    EXTERNAL_TOOL_NAMES.updateConnectionObjective,
                  ]),
                });
              },
            }),
          ]
        : []),
      ...optionalTools,
    ];

    return filterToolsByDisabledSet(core, disabled);
  }

  createCapabilityTools(
    capabilityNames: readonly string[],
    options?: Pick<CreateCoreToolsOptions, 'disabledTools'>,
  ): AgentTool<any, any>[] {
    const disabled = options?.disabledTools;
    const raw: AgentTool<any, any>[] = [];
    const toolNames = new Set<string>();
    for (const toolName of getAgentCapabilityToolNames(capabilityNames)) {
      if (disabled?.has(toolName) || toolNames.has(toolName)) continue;
      toolNames.add(toolName);
      if (toolName === 'create_desktop_pet') raw.push(createDesktopPetTool() as AgentTool<any, any>);
    }
    return wrapToolsWithProtection(raw, this.deps.toolExecutorConfig);
  }

  getLazyCapabilityToolNames(): string[] {
    return [
      'create_desktop_pet',
    ];
  }

  createAllTools(coreOptions?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools(coreOptions);
    const wrapped = wrapToolsWithProtection(coreTools, this.deps.toolExecutorConfig);

    return sortToolsForPromptCache(wrapped);
  }
}

function filterToolsByDisabledSet(
  tools: any[],
  disabled: Set<string> | undefined,
): any[] {
  if (!disabled || disabled.size === 0) {
    return tools;
  }
  return tools.filter((t) => !disabled.has(t.name));
}

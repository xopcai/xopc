import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
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
import { BROWSER_CONTROL_ENDPOINT_TOOL_NAME } from '@xopcai/browser-control-contract';
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
import { ComputerRuntime } from '../../computer/runtime.js';
import { createComputerUseTool } from './computer-use-tool.js';
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
  getCurrentContext: () => { channel: string; chatId: string; conversationId: string; origin: TurnOrigin } | null;
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
  conversationId?: string;
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
    return JSON.stringify({
      driver: this.deps.getConfig?.()?.browser.driver ?? null,
      extensionConnected: this.hasBrowserEndpoint(),
    });
  }

  private hasBrowserEndpoint(): boolean {
    return this.deps.endpointTools?.registry.list().some((endpoint) => endpoint.kind === 'browser'
      && endpoint.tools.some((tool) => tool.descriptor.name === BROWSER_CONTROL_ENDPOINT_TOOL_NAME)) ?? false;
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
    const inflight = checkBrowserReadiness(this.deps.getConfig?.(), {
      extensionConnected: this.hasBrowserEndpoint(),
      checkExtensionInstall: false,
    });
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
          return createBrowserDriver(config.browser, this.deps.endpointTools);
        },
        allowedUploadRoots: [this.deps.workspace],
        emit: this.deps.emitBrowserEvent,
        resolveTarget: (conversationId) => {
          const binding = getBrowserTabBinding(conversationId);
          if (binding) return { kind: 'attached_tab', bindingId: binding.id };
          const endpointBinding = this.deps.endpointTools?.bindings.get(conversationId);
          return endpointBinding
            ? { kind: 'endpoint', endpointId: endpointBinding.endpointId }
            : undefined;
        },
      });
    }
    return this.browserRuntime;
  }

  private computerRuntime?: ComputerRuntime;
  private ensureComputerRuntime(): ComputerRuntime {
    if (!this.deps.endpointTools) throw new Error('Computer endpoint runtime is unavailable');
    return this.computerRuntime ??= new ComputerRuntime(this.deps.endpointTools, () => {
      const config = this.deps.getConfig?.();
      if (!config) throw new Error('Computer configuration is unavailable');
      return config;
    }, owner => {
      const context = this.deps.getCurrentContext();
      return context?.conversationId === owner && context.origin.type === 'endpoint' ? context.origin.endpointId : undefined;
    });
  }

  /** Close Playwright and all pages (gateway stop, agent manager dispose, or config hot-reload). */
  async shutdownBrowser(): Promise<void> {
    await this.computerRuntime?.shutdown();
    this.computerRuntime = undefined;
    this.browserReadinessCache = null;
    if (!this.browserRuntime) {
      return;
    }
    await this.browserRuntime.shutdown();
    this.browserRuntime = null;
  }

  /** Drop the tab for a session when its agent instance is removed. */
  async closeBrowserPageForSession(conversationId: string): Promise<void> {
    await this.computerRuntime?.close(conversationId);
    await this.browserRuntime?.closeTaskSession(conversationId);
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
    const currentConversationId = () => options?.conversationId ?? this.deps.getCurrentContext?.()?.conversationId;
    const deliveryContext = () => {
      if ((currentConversationId() && getSessionMetadata(currentConversationId()!)?.sessionType === 'heartbeat')) {
        throw new Error('Heartbeat notifications must be returned in the final response for policy-controlled delivery.');
      }
      return this.deps.getCurrentContext();
    };
    const currentAccess = () => resolveUserContextSessionAccess(this.deps.getConfig?.(), currentConversationId());
    const knowledgeWritePolicy = () => this.deps.getConfig?.()?.userContext.knowledgeMemory.writePolicy ?? 'deny';
    const currentProjectId = () => {
      const key = currentConversationId();
      return key ? getSessionMetadata(key)?.projectId : undefined;
    };
    const getCommandIsolation = () => {
      const config = this.deps.getConfig?.();
      return config ? (currentConversationId() ? resolveEffectiveAgentConfigForSession(config, currentConversationId()) : resolveEffectiveAgentConfigForAgent(config, resolvedAgentId)).config.runtime.commandIsolation : undefined;
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
            return (request) => req({ conversationId: executionSession, runId, toolCallId }, request);
          }
          const ctx = this.deps.getCurrentContext();
          if (!ctx?.conversationId) return null;
          if (!CLARIFY_SUPPORTED_CHANNELS.has(ctx.channel)) return null;
          if (!runId) return null;
          return (request) => req({ conversationId: ctx.conversationId, runId, toolCallId }, request);
        },
      }),
      createTodoTool({
        getConversationId: () => this.deps.getCurrentContext()?.conversationId,
        repository: {
          isAvailable: isXopcDatabaseOpen,
          read: (conversationId) => getSessionTaskPlan(conversationId)?.items ?? [],
          write: (conversationId, items) => {
            setSessionTaskPlan({ conversationId, items });
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
            getConversationId: () => this.deps.getCurrentContext()?.conversationId,
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
        getConversationId: () => this.deps.getCurrentContext()?.conversationId,
        getSkillPassthroughEnvVarNames: this.deps.getSkillPassthroughEnvVarNames,
        prepareEnv: this.prepareRuntimeEnv,
      }),
      createReviewWorkspaceTool(workspace),
      createLanguageDiagnosticsTool(workspace, { getCommandIsolation, getConversationId: () => this.deps.getCurrentContext()?.conversationId, prepareEnv: this.prepareRuntimeEnv }),
      createManagedJobTool(
        workspace,
        () => this.deps.getCurrentContext()?.conversationId,
        this.deps.getSkillPassthroughEnvVarNames,
        this.prepareRuntimeEnv,
        getCommandIsolation,
      ),
      createWebSearchTool(() => this.deps.getConfig?.()),
      createWebFetchTool(() => this.deps.getConfig?.()),
      createWebExtractTool({ getConfig: () => this.deps.getConfig?.() }),
      // Note: TTS is NOT handled by send_message tool anymore
      // TTS is applied at the ChannelManager dispatch layer
      createMessageTool(bus, deliveryContext),
      ...(mergeTtsConfigFromAppConfig(cfg?.messages?.tts).enabled
        ? [
            createTextToSpeechTool({
              bus,
              getContext: deliveryContext,
              getConfig: () => this.deps.getConfig?.(),
            }),
          ]
        : []),
      createSendMediaTool(workspace, bus, deliveryContext),
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
        getSessionId: currentConversationId,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
      }),
      createUserContextGetTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentConversationId,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
      }),
      createUserContextUpdateTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentConversationId,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().userModel,
        canWrite: () => currentAccess().userModel,
        getCurrentUserText: () => {
          const conversationId = currentConversationId();
          return conversationId ? getPendingTranscriptUserText(conversationId) : undefined;
        },
      }),
      createKnowledgeSearchTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentConversationId,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().knowledge,
        canWrite: () => currentAccess().knowledge,
        getWritePolicy: knowledgeWritePolicy,
        getSources: () => currentAccess().knowledgeSources,
      }),
      createKnowledgeGetTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentConversationId,
        getProjectId: currentProjectId,
        canRead: () => currentAccess().knowledge,
        canWrite: () => currentAccess().knowledge,
        getWritePolicy: knowledgeWritePolicy,
        getSources: () => currentAccess().knowledgeSources,
      }),
      createKnowledgeWriteTool({
        agentId: resolvedAgentId,
        workspaceId: workspace,
        getSessionId: currentConversationId,
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
              getCurrentConversationId: () => this.deps.getCurrentContext()?.conversationId,
            }),
          ]
        : []),
      ...(this.deps.getSessionStore && getPrimary
        ? [
            createSessionSearchTool({
              getSessionStore: this.deps.getSessionStore,
              getPrimaryModel: getPrimary,
              getCurrentConversationId: () => this.deps.getCurrentContext()?.conversationId,
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
              getWorkspace: () => this.deps.workspace,
              getConfig: () => this.deps.getConfig?.(),
              getCurrentAgentId: () => options.agentId,
              getCurrentConversationId: () => this.deps.getCurrentContext()?.conversationId,
              getAutomationService: this.deps.getAutomationService,
              getNotesService: this.deps.getNotesService,
              getProjectService: this.deps.getProjectService,
              getLocalAppService: this.deps.getLocalAppService,
              dispatchTaskEvents: this.deps.dispatchTaskEvents,
              dispatchTaskRuns: this.deps.dispatchTaskRuns,
            }),
          ]
        : []),
      ...(cfg?.computer.enabled && this.deps.endpointTools && this.deps.gatewayClarify
        ? [createComputerUseTool({
            runtime: this.ensureComputerRuntime(),
            context: () => {
              const conversationId = getEmbeddedExecutionSession() ?? currentConversationId();
              const runId = getEmbeddedExecutionRunId();
              if (!conversationId || !runId) throw new Error('Computer Use requires an active interactive run');
              return { conversationId, runId };
            },
            requestClarification: this.deps.gatewayClarify.requestClarification,
          })]
        : []),
      ...(browserEnabled
        ? [
            createBrowserUseTool({
              getRuntime: () => this.ensureBrowserRuntime(),
              getTaskId: () => options?.conversationId ?? this.deps.getCurrentContext()?.conversationId ?? 'default',
              getReadiness: () => this.checkBrowserReadinessCached(),
            }),
          ]
        : []),
      ...(primary
        ? [
            createWorkflowTool({
              catalog: createWorkflowCatalog(),
              getCurrentConversationId: () => this.deps.getCurrentContext()?.conversationId,
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
                  endpointTools: childOpts.endpointTools ?? this.deps.endpointTools,
                  toolExecutorConfig: childOpts.toolExecutorConfig,
                });
                return childFactory.createAllTools({
                  workspace: childOpts.workspace,
                  getPrimaryModel: () => childOpts.model,
                  agentId: options?.agentId ?? childOpts.agentId,
                  conversationId: childOpts.browserConversationId,
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

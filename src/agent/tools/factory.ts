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
import type { Page } from 'playwright-core';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import {
  createReadFileTool,
  createWriteFileTool,
  createApplyPatchTool,
  createListDirTool,
  createGrepTool,
  createFindTool,
  createExecCommandTool,
  createWebSearchTool,
  createWebFetchTool,
  createWebExtractTool,
  createMessageTool,
  createComposioExecuteTool,
  createSendMediaTool,
  createReadMediaTool,
  createCreateShareTool,
  isShareToolAvailable,
  createMemorySearchTool,
  createMemoryGetTool,
  createTodoTool,
  createUpdatePlanTool,
  createSessionStatusTool,
  createDreamingTool,
  createClarifyTool,
  createToolManualTool,
  createGoalTool,
  createAutomationTool,
  createXopcUseTool,
  createDesktopPetTool,
  createSkillInstallTool,
  type SkillInstallToolOptions,
  type SkillInstallToolResult,
} from './index.js';
import { createCuratedMemoryTool } from './curated-memory-tool.js';
import { createSessionSearchTool } from './session-search-tool.js';
import type { MemoryManager } from '../memory/manager.js';
import { shouldRegisterCuratedMemoryTool } from '../memory/memory-config.js';
import type { SessionStore } from '../../session/store.js';
import type { GatewayClarifyRequestFn } from './clarify-tool.js';
import { createImageTool } from './image-tool.js';
import { createImageGenerateTool } from './image-generate-tool.js';
import {
  BrowserManager,
  BrowserNotReadyError,
  CdpSupervisor,
  checkBrowserReadiness,
  resolveBrowserBackendFromConfig,
} from '../../browser/index.js';
import { createBrowserUseTool } from './browser/tool/browser-use-tool.js';
import { createDelegateTool } from './delegate-tool.js';
import { createWorkflowTool } from './workflow-tool.js';
import { createWorkflowCatalog } from '../workflow/catalog.js';
import { resolveDreamingRootForAgent } from '../memory/dreaming/scope.js';
import { buildSandboxToolMap, createExecuteCodeTool } from './execute-code-tool.js';
import type { AutomationService } from '../../automations/index.js';
import type { NotesService } from '../../notes/index.js';
import type { ProjectService } from '../../projects/index.js';
import type { WorkItemService } from '../../work-items/index.js';
import type { WorkflowRunServiceLike } from '../../workflows/service/workflow-run-service.types.js';
import { createLogger } from '../../utils/logger.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { wrapToolsWithProtection, type ToolExecutorConfig } from './executor.js';
import { createSkillsListTool, createSkillViewTool } from './skills-tools.js';
import { createSkillManageTool } from './skill-manage-tool.js';
import { createTextToSpeechTool } from './tts-tool.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';
import { createGoalEvidenceRecorder } from './goal-evidence-recorder.js';
import { getAgentCapabilityToolNames } from '../capabilities/index.js';

const log = createLogger('AgentToolsFactory');

/** Channels where `clarify` can block for a user answer (web UI, Telegram, CLI readline). */
const CLARIFY_SUPPORTED_CHANNELS = new Set(['webchat', 'telegram', 'cli']);

export interface ToolFactoryDeps {
  workspace: string;
  extensionRegistry?: any;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string } | null;
  hookRunner?: import('../../extensions/index.js').ExtensionHookRunner;
  bus: MessageBus;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /** Agent defaults (image tools, etc.); use getter so hot-reloaded config applies. */
  getConfig?: () => Config | undefined;
  /** Session / default chat model for vision tool description. */
  getPrimaryModel?: () => Model<Api>;
  /** Memory orchestration (prefetch/sync + external tools). */
  getMemoryManager?: () => MemoryManager;
  /** Session store for `session_search`. */
  getSessionStore?: () => SessionStore;
  /** When set (gateway webchat), enables the `clarify` tool. */
  gatewayClarify?: { requestClarification: GatewayClarifyRequestFn };
  /** Gateway: enables the `automation` tool. */
  getAutomationService?: () => AutomationService | undefined;
  /** Gateway: enables the `xopc_use` product-object tool. */
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getWorkItemService?: () => WorkItemService | undefined;
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
  /** Agent-scoped memories directory used for dreaming state (`agents/<id>/memories`). */
  dreamingRoot?: string;
  agentId?: string;
  /** When set, registers `skills_list` and `skill_view` bound to this workspace\'s skills. */
  getSkillManager?: () => SkillManager;
}

export class AgentToolsFactory {
  private browserManager: BrowserManager | null = null;
  /** One dialog/console supervisor per chat session (browser tab). */
  private readonly browserTaskSupervisors = new Map<string, CdpSupervisor>();
  /** Cached readiness probe — keyed by backend mode + extension host:port. */
  private browserReadinessCache: {
    key: string;
    expiresAt: number;
    inflight?: Promise<BrowserNotReadyError | null>;
    result?: BrowserNotReadyError | null;
  } | null = null;

  constructor(private deps: ToolFactoryDeps) {}

  private browserReadinessKey(): string {
    const cfg = this.deps.getConfig?.();
    const backend = resolveBrowserBackendFromConfig(cfg);
    const host = '127.0.0.1';
    const port = 19820;
    const cdpUrl = backend.mode === 'cdp' ? backend.config.wsEndpoint : '';
    const cloudKind = backend.mode === 'cloud' ? backend.config.type : '';
    return `${backend.mode}@${host}:${port}|${cdpUrl}|${cloudKind}`;
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

  private browserSupervisorForTask(taskId: string): CdpSupervisor {
    let s = this.browserTaskSupervisors.get(taskId);
    if (!s) {
      s = new CdpSupervisor({ dialogPolicy: 'auto_dismiss', dialogTimeoutSeconds: 300 });
      this.browserTaskSupervisors.set(taskId, s);
    }
    return s;
  }

  private async acquireBrowserPage(): Promise<Page> {
    const taskId = this.deps.getCurrentContext()?.sessionKey ?? 'default';
    const mgr = this.ensureBrowserManager();
    await mgr.ensureConnected();
    if (mgr.getExtensionProvider()) {
      return null as unknown as Page;
    }
    const page = await mgr.getPage(taskId);
    this.browserSupervisorForTask(taskId).attach(page);
    return page;
  }

  private ensureBrowserManager(): BrowserManager {
    if (!this.browserManager) {
      this.browserManager = new BrowserManager({
        getHeadless: () => false,
        getBackend: () => resolveBrowserBackendFromConfig(this.deps.getConfig?.()),
      });
    }
    return this.browserManager;
  }

  /** Close Playwright and all pages (gateway stop, agent manager dispose, or config hot-reload). */
  async shutdownBrowser(): Promise<void> {
    this.browserReadinessCache = null;
    if (!this.browserManager) {
      return;
    }
    await this.browserManager.shutdown();
    this.browserManager = null;
    this.browserTaskSupervisors.clear();
  }

  /** Drop the tab for a session when its agent instance is removed. */
  async closeBrowserPageForSession(sessionKey: string): Promise<void> {
    this.browserTaskSupervisors.delete(sessionKey);
    await this.browserManager?.closePage(sessionKey);
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
    const dreamingRoot = options?.dreamingRoot ?? (cfg ? resolveDreamingRootForAgent(cfg, options?.agentId) : workspace);
    const browserEnabled = cfg?.browser?.enabled !== false;
    const recordGoalEvidence = createGoalEvidenceRecorder({
      getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
    });
    const imageTool = createImageTool({
      config: cfg,
      workspace,
      modelHasVision,
    });
    const imageGenerateTool = createImageGenerateTool({
      config: cfg,
      workspace,
    });

    const composioTool = createComposioExecuteTool(() => this.deps.getConfig?.());
    const optionalTools = [imageTool, imageGenerateTool, composioTool].filter((t) => t != null) as any[];

    const readTool = createReadFileTool(workspace, {
      profileMarkdownRoot: options?.profileMarkdownRoot,
    });
    const writeTool = createWriteFileTool(workspace, {
      profileMarkdownRoot: options?.profileMarkdownRoot,
      recordGoalEvidence,
    });
    const applyPatchTool = createApplyPatchTool(workspace, { recordGoalEvidence });
    const listDir = createListDirTool(workspace);
    const grep = createGrepTool(workspace);
    const find = createFindTool(workspace);

    const core: AgentTool<any, any>[] = [
      createSessionStatusTool(),
      createDreamingTool({
        getWorkspace: () => workspace,
        getDreamingRoot: () => dreamingRoot,
        getConfig: () => this.deps.getConfig?.(),
        getAgentId: () => options?.agentId,
      }),
      createToolManualTool(),
      createClarifyTool({
        resolveAskUser: () => {
          const req = this.deps.gatewayClarify?.requestClarification;
          if (!req) return null;
          const ctx = this.deps.getCurrentContext();
          if (!ctx?.sessionKey) return null;
          if (!CLARIFY_SUPPORTED_CHANNELS.has(ctx.channel)) return null;
          return (r) => req(ctx.sessionKey, r);
        },
      }),
      createTodoTool({
        getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
      }),
      createUpdatePlanTool(),
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
      readTool,
      writeTool,
      applyPatchTool,
      listDir,
      grep,
      find,
      createExecCommandTool(workspace, {
        getSkillPassthroughEnvVarNames: this.deps.getSkillPassthroughEnvVarNames,
        recordGoalEvidence,
      }),
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
      createReadMediaTool(),
      ...(isShareToolAvailable(cfg)
        ? [
            createCreateShareTool({
              workspace,
              getConfig: () => this.deps.getConfig?.(),
            }),
          ]
        : []),
      ...(getMemMgr
        ? [
            createMemorySearchTool({ workspaceDir: workspace, dreamingRoot, getMemoryManager: () => getMemMgr() }),
            createMemoryGetTool({ workspaceDir: workspace, dreamingRoot, getMemoryManager: () => getMemMgr() }),
          ]
        : []),
      ...(getMemMgr && shouldRegisterCuratedMemoryTool(this.deps.getConfig?.())
        ? [
            createCuratedMemoryTool(() => getMemMgr()),
          ]
        : []),
      ...(getMemMgr?.().getAdditionalTools() ?? []),
      ...(this.deps.getSessionStore
        ? [
            createSessionSearchTool({
              getSessionStore: this.deps.getSessionStore,
              getConfig: this.deps.getConfig,
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
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
      ...(this.deps.getProjectService || this.deps.getNotesService || this.deps.getWorkItemService
        ? [
            createXopcUseTool({
              getConfig: () => this.deps.getConfig?.(),
              getCurrentAgentId: () => options.agentId,
              getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
              getNotesService: this.deps.getNotesService,
              getProjectService: this.deps.getProjectService,
              getWorkItemService: this.deps.getWorkItemService,
            }),
          ]
        : []),
      createGoalTool({
        getCurrentSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
      }),
      ...(browserEnabled
        ? [
            createBrowserUseTool({
              getManager: () => this.ensureBrowserManager(),
              getPageForTask: () => this.acquireBrowserPage(),
              getTaskId: () => this.deps.getCurrentContext()?.sessionKey ?? 'default',
              getConfig: () => this.deps.getConfig?.(),
              getReadiness: () => this.checkBrowserReadinessCached(),
              getSupervisor: () =>
                this.browserSupervisorForTask(this.deps.getCurrentContext()?.sessionKey ?? 'default'),
              notifyBrowserPageClosed: (taskId) => {
                this.browserTaskSupervisors.delete(taskId);
              },
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
      ...(false && primary
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
              hookRunner: this.deps.hookRunner,
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
                  dreamingRoot: options?.dreamingRoot,
                  disabledTools: new Set(['extensions']),
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
      if (toolName === 'skill_install') {
        raw.push(createSkillInstallTool({
          installSkillFromSource: this.deps.installSkillFromSource,
          getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
        }) as AgentTool<any, any>);
      }
    }
    return wrapToolsWithProtection(raw, this.deps.toolExecutorConfig);
  }

  getLazyCapabilityToolNames(): string[] {
    return [
      'create_desktop_pet',
      ...(this.deps.installSkillFromSource ? ['skill_install'] : []),
    ];
  }

  createAllTools(coreOptions?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools(coreOptions);
    const disableExtensions = coreOptions?.disabledTools?.has('extensions');

    let bundled: AgentTool<any, any>[];
    if (!this.deps.extensionRegistry || disableExtensions) {
      bundled = coreTools;
    } else {
      const extensionTools = this.deps.extensionRegistry.getAllTools();
      log.info({ count: extensionTools.length }, 'Loaded extension tools');
      bundled = [...coreTools, ...extensionTools];
    }

    const wrapped = wrapToolsWithProtection(bundled, this.deps.toolExecutorConfig);

    const executeEnabled = false && !coreOptions?.disabledTools?.has('execute_code');

    if (executeEnabled) {
      const sandboxMap = buildSandboxToolMap(wrapped);
      const executeTool = createExecuteCodeTool({ getSandboxToolMap: () => sandboxMap });
      const wrappedExecute = wrapToolsWithProtection([executeTool as any], this.deps.toolExecutorConfig);
      return [...wrapped, ...wrappedExecute];
    }

    return wrapped;
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

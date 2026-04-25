/**
 * Agent Tools Factory - Creates and configures agent tools
 *
 * Centralizes tool creation logic to keep service.ts focused on orchestration.
 *
 * TTS: auto TTS is applied at the ChannelManager via maybeApplyTtsToPayload().
 * Optional \`text_to_speech\` tool sends explicit voice when TTS is enabled.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirTool,
  createGrepTool,
  createFindTool,
  createShellTool,
  createWebSearchTool,
  webFetchTool,
  createWebExtractTool,
  createMessageTool,
  createSendMediaTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createTodoTool,
  createSessionStatusTool,
  createClarifyTool,
} from './index.js';
import { createCuratedMemoryTool } from './curated-memory-tool.js';
import { createSessionSearchTool } from './session-search-tool.js';
import type { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';
import type { MemoryManager } from '../memory/manager.js';
import { shouldRegisterCuratedMemoryTool } from '../memory/memory-config.js';
import type { SessionStore } from '../../session/store.js';
import { parseSessionKey as parseRoutingSessionKey } from '../../routing/session-key.js';
import type { GatewayClarifyRequestFn } from './clarify-tool.js';
import { createImageTool } from './image-tool.js';
import { createImageGenerateTool } from './image-generate-tool.js';
import { BrowserManager, createBrowserTools } from './browser/index.js';
import { createDelegateTool } from './delegate-tool.js';
import { buildSandboxToolMap, createExecuteCodeTool } from './execute-code-tool.js';
import { createCronjobTool } from './cronjob-tool.js';
import type { CronService } from '../../cron/index.js';
import { createLogger } from '../../utils/logger.js';
import type { SkillManager } from '../skills/skill-manager.js';
import { wrapToolsWithProtection, type ToolExecutorConfig } from './executor.js';
import { createSkillsListTool, createSkillViewTool } from './skills-tools.js';
import { createSkillManageTool } from './skill-manage-tool.js';
import { createTextToSpeechTool } from './tts-tool.js';
import { mergeTtsConfigFromAppConfig } from '../../voice/tts/merge-config.js';

const log = createLogger('AgentToolsFactory');

/** Channels where `clarify` can block for a user answer (web UI, Telegram, CLI readline). */
const CLARIFY_SUPPORTED_CHANNELS = new Set(['webchat', 'telegram', 'cli']);

function clarifyTransportSource(sessionKey: string): string | undefined {
  const parsed = parseRoutingSessionKey(sessionKey);
  if (parsed) return parsed.source;
  // Fallback for simple `<channel>:<chatId>` keys used by webchat and CLI.
  const first = sessionKey.split(':').filter(Boolean)[0] ?? '';
  if (first === 'cli' || first === 'webchat') return first;
  return undefined;
}

export interface ToolFactoryDeps {
  workspace: string;
  extensionRegistry?: any;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string } | null;
  bus: MessageBus;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /** Agent defaults (image tools, etc.); use getter so hot-reloaded config applies. */
  getConfig?: () => Config | undefined;
  /** Session / default chat model for vision tool description. */
  getPrimaryModel?: () => Model<Api>;
  /** Built-in curated memory store (agent home `memories/`). */
  getBuiltinMemoryStore?: () => BuiltinMemoryStore;
  /** Memory orchestration (prefetch/sync + external tools). */
  getMemoryManager?: () => MemoryManager;
  /** Session store for `session_search`. */
  getSessionStore?: () => SessionStore;
  /** When set (gateway webchat), enables the `clarify` tool. */
  gatewayClarify?: { requestClarification: GatewayClarifyRequestFn };
  /** Gateway: enables the `cronjob` tool. */
  getCronService?: () => CronService | undefined;
  /** Current session skill indexing (tool gating + allowlist); used by skills_list / skill_view. */
  getSkillIndexingContext?: () =>
    | { registeredToolNames: string[]; skillAllowlist?: string[] }
    | undefined;
  /** After skill_manage mutates disk, reload skills + refresh agent prompts (optional). */
  onSkillsFilesystemMutate?: () => void;
  /** Names registered via skill_view for shell env passthrough. */
  getSkillPassthroughEnvVarNames?: () => string[];
  /** Add declared env names for the current session (no values stored). */
  registerSkillEnvPassthrough?: (names: string[]) => void;
}

export interface CreateCoreToolsOptions {
  /** Workspace root for file/shell tools (defaults to factory workspace). */
  workspace?: string;
  /** `…/agents/<id>/bootstrap` — used so `read_file` can find SOUL.md etc. by filename. */
  bootstrapDir?: string;
  /** Tool `name` values to omit (e.g. `shell`, `extensions` for extension tools). */
  disabledTools?: Set<string>;
  /** Optional primary model for image tool heuristics. */
  getPrimaryModel?: () => Model<Api>;
  getBuiltinMemoryStore?: () => BuiltinMemoryStore;
  getMemoryManager?: () => MemoryManager;
  /** When set, registers `skills_list` and `skill_view` bound to this workspace\'s skills. */
  getSkillManager?: () => SkillManager;
}

export class AgentToolsFactory {
  private browserManager: BrowserManager | null = null;

  constructor(private deps: ToolFactoryDeps) {}

  private ensureBrowserManager(): BrowserManager {
    if (!this.browserManager) {
      this.browserManager = new BrowserManager({
        getHeadless: () => this.deps.getConfig?.()?.agents?.defaults?.browser?.headless !== false,
      });
    }
    return this.browserManager;
  }

  /** Close Playwright and all pages (gateway stop, agent manager dispose, or config hot-reload). */
  async shutdownBrowser(): Promise<void> {
    if (!this.browserManager) {
      return;
    }
    await this.browserManager.shutdown();
    this.browserManager = null;
  }

  /** Drop the tab for a session when its agent instance is removed. */
  async closeBrowserPageForSession(sessionKey: string): Promise<void> {
    await this.browserManager?.closePage(sessionKey);
  }

  createCoreTools(options?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const workspace = options?.workspace ?? this.deps.workspace;
    const { bus } = this.deps;
    const getPrimary = options?.getPrimaryModel ?? this.deps.getPrimaryModel;
    const getBuiltin = options?.getBuiltinMemoryStore ?? this.deps.getBuiltinMemoryStore;
    const getMemMgr = options?.getMemoryManager ?? this.deps.getMemoryManager;
    const getSkillMgr = options?.getSkillManager;
    const disabled = options?.disabledTools;

    const primary = getPrimary?.();
    const modelHasVision = primary?.input?.includes('image') ?? false;
    const cfg = this.deps.getConfig?.();
    const imageTool = createImageTool({
      config: cfg,
      workspace,
      modelHasVision,
    });
    const imageGenerateTool = createImageGenerateTool({
      config: cfg,
      workspace,
    });

    const optionalTools = [imageTool, imageGenerateTool].filter(
      (t): t is AgentTool<any, any> => t != null,
    );

    const readTool = createReadFileTool(workspace, { bootstrapDir: options?.bootstrapDir });
    const writeTool = createWriteFileTool(workspace);
    const editTool = createEditFileTool(workspace);
    const listDir = createListDirTool(workspace);
    const grep = createGrepTool(workspace);
    const find = createFindTool(workspace);

    const core: AgentTool<any, any>[] = [
      createSessionStatusTool(),
      createClarifyTool({
        resolveAskUser: () => {
          const req = this.deps.gatewayClarify?.requestClarification;
          if (!req) return null;
          const ctx = this.deps.getCurrentContext();
          if (!ctx?.sessionKey) return null;
          const source = clarifyTransportSource(ctx.sessionKey);
          if (!source || !CLARIFY_SUPPORTED_CHANNELS.has(source)) return null;
          return (r) => req(ctx.sessionKey, r);
        },
      }),
      createTodoTool({
        getSessionKey: () => this.deps.getCurrentContext()?.sessionKey,
      }),
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
      editTool,
      listDir,
      grep,
      find,
      createShellTool(workspace, {
        getSkillPassthroughEnvVarNames: this.deps.getSkillPassthroughEnvVarNames,
      }),
      createWebSearchTool(() => this.deps.getConfig?.()),
      webFetchTool,
      createWebExtractTool({ getConfig: () => this.deps.getConfig?.() }),
      // Note: TTS is NOT handled by send_message tool anymore
      // TTS is applied at the ChannelManager dispatch layer
      createMessageTool(bus, () => this.deps.getCurrentContext()),
      ...(mergeTtsConfigFromAppConfig(cfg?.tts).enabled
        ? [
            createTextToSpeechTool({
              bus,
              getContext: () => this.deps.getCurrentContext(),
              getConfig: () => this.deps.getConfig?.(),
            }),
          ]
        : []),
      createSendMediaTool(workspace, bus, () => this.deps.getCurrentContext()),
      createMemorySearchTool(workspace),
      createMemoryGetTool(workspace),
      ...(getBuiltin && shouldRegisterCuratedMemoryTool(this.deps.getConfig?.())
        ? [
            createCuratedMemoryTool(getBuiltin, {
              onMemoryWrite: (action, target, content) => {
                getMemMgr?.().onMemoryWrite(action, target, content);
              },
            }),
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
      ...(this.deps.getCronService
        ? [
            createCronjobTool({
              getCronService: this.deps.getCronService,
            }),
          ]
        : []),
      ...(cfg?.agents?.defaults?.browser?.enabled === true
        ? createBrowserTools({
            getManager: () => this.ensureBrowserManager(),
            getTaskId: () => this.deps.getCurrentContext()?.sessionKey ?? 'default',
            getConfig: () => this.deps.getConfig?.(),
          })
        : []),
      ...(cfg?.agents?.defaults?.delegate?.enabled === true && primary
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
              toolExecutorConfig: this.deps.toolExecutorConfig,
            }),
          ]
        : []),
      ...optionalTools,
    ];

    return filterToolsByDisabledSet(core, disabled);
  }

  createAllTools(coreOptions?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools(coreOptions);
    const disableExtensions = coreOptions?.disabledTools?.has('extensions');
    const cfg = this.deps.getConfig?.();

    let bundled: AgentTool<any, any>[];
    if (!this.deps.extensionRegistry || disableExtensions) {
      bundled = coreTools;
    } else {
      const extensionTools = this.deps.extensionRegistry.getAllTools();
      log.info({ count: extensionTools.length }, 'Loaded extension tools');
      bundled = [...coreTools, ...extensionTools];
    }

    const wrapped = wrapToolsWithProtection(bundled, this.deps.toolExecutorConfig);

    const executeEnabled =
      cfg?.agents?.defaults?.executeCode?.enabled === true &&
      !coreOptions?.disabledTools?.has('execute_code');

    if (executeEnabled) {
      const sandboxMap = buildSandboxToolMap(wrapped);
      const executeTool = createExecuteCodeTool({ getSandboxToolMap: () => sandboxMap });
      const wrappedExecute = wrapToolsWithProtection([executeTool], this.deps.toolExecutorConfig);
      return [...wrapped, ...wrappedExecute];
    }

    return wrapped;
  }
}

function filterToolsByDisabledSet(
  tools: AgentTool<any, any>[],
  disabled: Set<string> | undefined,
): AgentTool<any, any>[] {
  if (!disabled || disabled.size === 0) {
    return tools;
  }
  return tools.filter((t) => !disabled.has(t.name));
}

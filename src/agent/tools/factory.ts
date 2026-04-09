/**
 * Agent Tools Factory - Creates and configures agent tools
 *
 * Centralizes tool creation logic to keep service.ts focused on orchestration.
 *
 * TTS Architecture Note:
 * TTS is NOT handled by tools anymore.
 * TTS is applied at the ChannelManager dispatch layer via maybeApplyTtsToPayload().
 * This prevents duplicate voice messages.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepTool,
  findTool,
  createShellTool,
  createWebSearchTool,
  webFetchTool,
  createMessageTool,
  createSendMediaTool,
  createMemorySearchTool,
  createMemoryGetTool,
} from './index.js';
import { createCuratedMemoryTool } from './curated-memory-tool.js';
import { createSessionSearchTool } from './session-search-tool.js';
import type { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';
import type { MemoryManager } from '../memory/manager.js';
import { shouldRegisterCuratedMemoryTool } from '../memory/memory-config.js';
import type { SessionStore } from '../../session/store.js';
import { createImageTool } from './image-tool.js';
import { createImageGenerateTool } from './image-generate-tool.js';
import { createLogger } from '../../utils/logger.js';
import { wrapToolsWithProtection, type ToolExecutorConfig } from './executor.js';

const log = createLogger('AgentToolsFactory');

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
  /** Built-in curated memory store (`.xopcbot/memories/`). */
  getBuiltinMemoryStore?: () => BuiltinMemoryStore;
  /** Phase 2 memory orchestration (prefetch/sync + external tools). */
  getMemoryManager?: () => MemoryManager;
  /** Session store for `session_search` (Phase 3). */
  getSessionStore?: () => SessionStore;
  // TTS config removed - handled at dispatch layer
}

export interface CreateCoreToolsOptions {
  /** Workspace root for file/shell tools (defaults to factory workspace). */
  workspace?: string;
  /** Tool `name` values to omit (e.g. `shell`, `extensions` for extension tools). */
  disabledTools?: Set<string>;
  /** Optional primary model for image tool heuristics. */
  getPrimaryModel?: () => Model<Api>;
  getBuiltinMemoryStore?: () => BuiltinMemoryStore;
  getMemoryManager?: () => MemoryManager;
}

export class AgentToolsFactory {
  constructor(private deps: ToolFactoryDeps) {}

  createCoreTools(options?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const workspace = options?.workspace ?? this.deps.workspace;
    const { bus } = this.deps;
    const getPrimary = options?.getPrimaryModel ?? this.deps.getPrimaryModel;
    const getBuiltin = options?.getBuiltinMemoryStore ?? this.deps.getBuiltinMemoryStore;
    const getMemMgr = options?.getMemoryManager ?? this.deps.getMemoryManager;
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

    const core: AgentTool<any, any>[] = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirTool,
      grepTool,
      findTool,
      createShellTool(workspace),
      createWebSearchTool(() => this.deps.getConfig?.()),
      webFetchTool,
      // Note: TTS is NOT handled by send_message tool anymore
      // TTS is applied at the ChannelManager dispatch layer
      createMessageTool(bus, () => this.deps.getCurrentContext()),
      createSendMediaTool(bus, () => this.deps.getCurrentContext()),
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
      ...optionalTools,
    ];

    return filterToolsByDisabledSet(core, disabled);
  }

  createAllTools(coreOptions?: CreateCoreToolsOptions): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools(coreOptions);
    const disableExtensions = coreOptions?.disabledTools?.has('extensions');

    if (!this.deps.extensionRegistry || disableExtensions) {
      return wrapToolsWithProtection(coreTools, this.deps.toolExecutorConfig);
    }

    const extensionTools = this.deps.extensionRegistry.getAllTools();

    log.info({ count: extensionTools.length }, 'Loaded extension tools');

    const allTools = [...coreTools, ...extensionTools];
    return wrapToolsWithProtection(allTools, this.deps.toolExecutorConfig);
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

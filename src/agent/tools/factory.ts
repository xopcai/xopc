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
  // TTS config removed - handled at dispatch layer
}

export class AgentToolsFactory {
  constructor(private deps: ToolFactoryDeps) {}

  createCoreTools(): AgentTool<any, any>[] {
    const { workspace, bus } = this.deps;

    const primary = this.deps.getPrimaryModel?.();
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

    return [
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
      ...optionalTools,
    ];
  }

  createAllTools(): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools();

    if (!this.deps.extensionRegistry) {
      // Wrap core tools with timeout and retry protection
      return wrapToolsWithProtection(coreTools, this.deps.toolExecutorConfig);
    }

    const extensionTools = this.deps.extensionRegistry.getAllTools();

    log.info({ count: extensionTools.length }, 'Loaded extension tools');

    // Combine all tools and wrap with protection
    const allTools = [...coreTools, ...extensionTools];
    return wrapToolsWithProtection(allTools, this.deps.toolExecutorConfig);
  }
}

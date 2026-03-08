/**
 * Agent Tools Factory - Creates and configures agent tools
 *
 * Centralizes tool creation logic to keep service.ts focused on orchestration.
 *
 * TTS Architecture Note:
 * TTS is NOT handled by tools anymore. Following OpenClaw architecture,
 * TTS is applied at the ChannelManager dispatch layer via maybeApplyTtsToPayload().
 * This prevents duplicate voice messages.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ExtensionTool } from '../extensions/types/index.js';
import type { MessageBus } from '../bus/index.js';
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
} from './tools/index.js';
import { createLogger } from '../utils/logger.js';
import { wrapToolsWithProtection, type ToolExecutorConfig } from './tool-executor.js';

const log = createLogger('AgentToolsFactory');

export interface ToolFactoryDeps {
  workspace: string;
  braveApiKey?: string;
  extensionRegistry?: any;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string } | null;
  bus: MessageBus;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  // TTS config removed - handled at dispatch layer
}

export class AgentToolsFactory {
  constructor(private deps: ToolFactoryDeps) {}

  createCoreTools(): AgentTool<any, any>[] {
    const { workspace, braveApiKey, bus } = this.deps;

    return [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirTool,
      grepTool,
      findTool,
      createShellTool(workspace),
      createWebSearchTool(braveApiKey),
      webFetchTool,
      // Note: TTS is NOT handled by send_message tool anymore
      // TTS is applied at the ChannelManager dispatch layer
      createMessageTool(bus, () => this.deps.getCurrentContext()),
      createSendMediaTool(bus, () => this.deps.getCurrentContext()),
      createMemorySearchTool(workspace),
      createMemoryGetTool(workspace),
    ];
  }

  convertExtensionTools(extensionTools: ExtensionTool[]): AgentTool<any, any>[] {
    return extensionTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      label: `🔌 ${tool.name}`,
      async execute(toolCallId: string, params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
        try {
          const result = await tool.execute(params);
          return { content: [{ type: 'text', text: result }], details: {} };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            details: {},
          };
        }
      },
    }));
  }

  createAllTools(): AgentTool<any, any>[] {
    const coreTools = this.createCoreTools();
    
    if (!this.deps.extensionRegistry) {
      // Wrap core tools with timeout and retry protection
      return wrapToolsWithProtection(coreTools, this.deps.toolExecutorConfig);
    }

    const extensionTools = this.deps.extensionRegistry.getAllTools();
    const convertedTools = this.convertExtensionTools(extensionTools);
    
    log.info({ count: convertedTools.length }, 'Loaded extension tools');
    
    // Combine all tools and wrap with protection
    const allTools = [...coreTools, ...convertedTools];
    return wrapToolsWithProtection(allTools, this.deps.toolExecutorConfig);
  }
}

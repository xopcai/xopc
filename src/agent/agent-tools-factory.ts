/**
 * Agent Tools Factory - Creates and configures agent tools
 * 
 * Centralizes tool creation logic to keep service.ts focused on orchestration.
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

const log = createLogger('AgentToolsFactory');

export interface ToolFactoryDeps {
  workspace: string;
  braveApiKey?: string;
  extensionRegistry?: any;
  getCurrentContext: () => { channel: string; chatId: string; sessionKey: string } | null;
  bus: MessageBus;
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
      return coreTools;
    }

    const extensionTools = this.deps.extensionRegistry.getAllTools();
    const convertedTools = this.convertExtensionTools(extensionTools);
    
    log.info({ count: convertedTools.length }, 'Loaded extension tools');
    return [...coreTools, ...convertedTools];
  }
}

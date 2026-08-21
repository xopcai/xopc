import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { ExtensionHookRunner } from '../../extensions/index.js';
import type { MemoryManager } from '../memory/manager.js';
import { executeToolWithProtection, type ToolExecutorConfig } from '../tools/executor.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

export interface MemoryToolProviderDeps {
  getMemoryManager?: () => MemoryManager;
  disabledTools?: Set<string>;
  getSessionKey: () => string | undefined;
  hookRunner?: ExtensionHookRunner;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
}

function toolSummary(tool: AgentTool): string {
  return tool.description || tool.label || tool.name;
}

export class MemoryToolProvider implements ExternalToolProvider {
  readonly source = 'memory' as const;

  constructor(private readonly deps: MemoryToolProviderDeps) {}

  async search(_query: string): Promise<ExternalToolSearchHit[]> {
    return this.entries().map(({ providerId, tool }) => ({
      toolRef: externalToolRef(this.source, providerId, tool.name),
      source: this.source,
      namespace: providerId,
      title: tool.label || tool.name,
      summary: toolSummary(tool),
    }));
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    const resolved = this.resolve(toolRef);
    if (!resolved) return undefined;
    const summary = toolSummary(resolved.tool);
    return {
      toolRef,
      source: this.source,
      namespace: resolved.providerId,
      title: resolved.tool.label || resolved.tool.name,
      summary,
      description: summary,
      inputSchema: resolved.tool.parameters as Record<string, unknown>,
    };
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    _approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ) {
    const resolved = this.resolve(toolRef);
    if (!resolved) throw new Error(`Memory provider tool is unavailable: ${toolRef}`);
    let executionArgs = args;
    if (this.deps.hookRunner) {
      const hook = await this.deps.hookRunner.runBeforeToolCall(resolved.tool.name, args, {
        sessionKey: this.deps.getSessionKey(),
      });
      if (!hook.allowed) throw new Error(hook.reason ?? 'Memory provider tool call blocked by policy hook.');
      executionArgs = hook.params ?? args;
    }
    return executeToolWithProtection(
      resolved.tool,
      context.toolCallId,
      executionArgs,
      context.signal,
      context.onUpdate,
      this.deps.toolExecutorConfig,
    );
  }

  private entries(): Array<{ providerId: string; tool: AgentTool }> {
    return (this.deps.getMemoryManager?.().getExternalToolEntries() ?? [])
      .filter(({ tool }) => !this.deps.disabledTools?.has(tool.name));
  }

  private resolve(toolRef: string): { providerId: string; tool: AgentTool } | undefined {
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed) return undefined;
    return this.entries().find(({ providerId, tool }) => (
      providerId === parsed.namespace && tool.name === parsed.toolName
    ));
  }
}

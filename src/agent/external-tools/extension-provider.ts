import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { ExtensionHookRunner } from '../../extensions/index.js';
import type { ExtensionRegistry } from '../../extensions/types/index.js';
import { executeToolWithProtection, type ToolExecutorConfig } from '../tools/executor.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

export interface ExtensionToolProviderDeps {
  registry?: ExtensionRegistry;
  disabledTools?: Set<string>;
  getSessionKey: () => string | undefined;
  hookRunner?: ExtensionHookRunner;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
}

function toolSummary(tool: AgentTool): string {
  return tool.description || tool.label || tool.name;
}

export class ExtensionToolProvider implements ExternalToolProvider {
  readonly source = 'extension' as const;

  constructor(private readonly deps: ExtensionToolProviderDeps) {}

  async search(_query: string): Promise<ExternalToolSearchHit[]> {
    if (!this.deps.registry) return [];
    return this.deps.registry.getAllTools()
      .filter((tool) => !this.deps.disabledTools?.has(tool.name))
      .flatMap((tool): ExternalToolSearchHit[] => {
        const extensionId = this.deps.registry!.getToolExtensionId(tool.name);
        if (!extensionId) return [];
        return [{
          toolRef: externalToolRef(this.source, extensionId, tool.name),
          source: this.source,
          namespace: extensionId,
          title: tool.label || tool.name,
          summary: toolSummary(tool),
        }];
      });
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    const resolved = this.resolve(toolRef);
    if (!resolved) return undefined;
    const { extensionId, tool } = resolved;
    const summary = toolSummary(tool);
    return {
      toolRef,
      source: this.source,
      namespace: extensionId,
      title: tool.label || tool.name,
      summary,
      description: summary,
      inputSchema: tool.parameters as Record<string, unknown>,
    };
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    _approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ) {
    const resolved = this.resolve(toolRef);
    if (!resolved) throw new Error(`Extension tool is unavailable: ${toolRef}`);
    let executionArgs = args;
    if (this.deps.hookRunner) {
      const hook = await this.deps.hookRunner.runBeforeToolCall(resolved.tool.name, args, {
        extensionId: resolved.extensionId,
        sessionKey: this.deps.getSessionKey(),
      });
      if (!hook.allowed) throw new Error(hook.reason ?? 'Extension tool call blocked by policy hook.');
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

  private resolve(toolRef: string): { extensionId: string; tool: AgentTool<any, any> } | undefined {
    if (!this.deps.registry) return undefined;
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed || this.deps.disabledTools?.has(parsed.toolName)) return undefined;
    const tool = this.deps.registry.getTool(parsed.toolName);
    if (!tool || this.deps.registry.getToolExtensionId(parsed.toolName) !== parsed.namespace) {
      return undefined;
    }
    return { extensionId: parsed.namespace, tool };
  }
}

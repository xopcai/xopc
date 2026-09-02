import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
  ExternalToolTurnContext,
} from './types.js';

export interface EndpointToolProviderDeps {
  runtime: EndpointToolRuntime;
  getCurrentContext: () => ExternalToolTurnContext | null;
}

function contentText(content: EndpointToolContent): string {
  if (content.type === 'text') return content.text;
  if (content.type === 'json') return JSON.stringify(content.value, null, 2);
  return `[File: ${content.name}, ${content.mimeType}, ${content.size} bytes, id=${content.fileId}]`;
}

export class EndpointToolProvider implements ExternalToolProvider {
  readonly source = 'endpoint' as const;

  constructor(private readonly deps: EndpointToolProviderDeps) {}

  async search(_query: string): Promise<ExternalToolSearchHit[]> {
    const endpoint = this.currentEndpoint();
    if (!endpoint) return [];
    return endpoint.tools.map(({ descriptor }) => ({
      toolRef: externalToolRef(this.source, endpoint.endpointId, descriptor.name),
      source: this.source,
      namespace: endpoint.endpointId,
      title: descriptor.title,
      summary: `${descriptor.description} (${endpoint.displayName})`,
    }));
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    const resolved = this.resolve(toolRef);
    if (!resolved) return undefined;
    return {
      toolRef,
      source: this.source,
      namespace: resolved.endpointId,
      title: resolved.tool.descriptor.title,
      summary: `${resolved.tool.descriptor.description} (${resolved.displayName})`,
      description: resolved.tool.descriptor.description,
      inputSchema: resolved.tool.descriptor.inputSchema,
    };
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    _approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    const resolved = this.resolve(toolRef);
    if (!resolved) throw new Error(`Endpoint tool is unavailable for this turn: ${toolRef}`);
    const result = await this.deps.runtime.invocations.invoke({
      endpointId: resolved.endpointId,
      toolCallId: context.toolCallId,
      toolName: resolved.tool.descriptor.name,
      arguments: args,
      descriptorRevision: resolved.tool.revision,
      signal: context.signal,
      onProgress: (progress) => {
        context.onUpdate?.({
          content: [{ type: 'text', text: progress.message ?? 'Endpoint tool is running' }],
          details: {
            endpointId: resolved.endpointId,
            ...(progress.percent === undefined ? {} : { percent: progress.percent }),
          },
        });
      },
    });
    const files = result.content.filter((item) => item.type === 'file');
    return {
      content: result.content.map((item) => ({ type: 'text' as const, text: contentText(item) })),
      details: {
        endpointId: resolved.endpointId,
        endpointToolName: resolved.tool.descriptor.name,
        endpointSensitivity: resolved.tool.descriptor.sensitivity,
        ...(result.details ?? {}),
        ...(files.length === 0 ? {} : { endpointFiles: files }),
      },
    };
  }

  private currentEndpoint() {
    const context = this.deps.getCurrentContext();
    if (!context) return undefined;
    const binding = this.deps.runtime.bindings.get(context.sessionKey);
    if (binding) return this.deps.runtime.bindings.resolve(context.sessionKey);
    const origin = context.origin;
    if (origin?.type !== 'endpoint') return undefined;
    return this.deps.runtime.registry.get(origin.endpointId);
  }

  private resolve(toolRef: string) {
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed) return undefined;
    const endpoint = this.currentEndpoint();
    if (!endpoint || endpoint.endpointId !== parsed.namespace) return undefined;
    const tool = this.deps.runtime.registry.getTool(endpoint.endpointId, parsed.toolName);
    return tool ? { endpointId: endpoint.endpointId, displayName: endpoint.displayName, tool } : undefined;
  }
}

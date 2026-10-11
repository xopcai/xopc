import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { createHash } from 'node:crypto';
import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';
import { BROWSER_CONTROL_ENDPOINT_TOOL_NAME } from '@xopcai/browser-control-contract';
import { COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import { processLocationTask } from '../../endpoint-tools/location-task.js';
import { projectDeviceReading } from '../../endpoint-tools/result-projector.js';
import { getEndpointDeviceSettings } from '../../storage/sqlite/endpoint-device-settings-repository.js';
import { DeviceTargetResolver } from '../../endpoint-tools/target-resolver.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { EndpointToolExecutionError } from '../../endpoint-tools/invocation-service.js';
import { executeExternalOperation, ExternalEffectNotAppliedError } from '../../capabilities/runtime/external-operations.js';
import { canonicalCapabilityJson } from '../../capabilities/runtime/dispatcher.js';
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
    const context = this.deps.getCurrentContext();
    if (!context) return [];
    const resolver = this.targetResolver();
    return resolver.candidates(context.conversationId, context.origin).flatMap(endpoint => endpoint.tools.filter(({ descriptor }) => ![BROWSER_CONTROL_ENDPOINT_TOOL_NAME, COMPUTER_CONTROL_TOOL].includes(descriptor.name)
      && resolver.resolve(context.conversationId, context.origin, endpoint.endpointId, descriptor.name)).map(({ descriptor }) => ({
      toolRef: externalToolRef(this.source, endpoint.endpointId, descriptor.name),
      source: this.source,
      namespace: endpoint.endpointId,
      title: descriptor.title,
      summary: `${descriptor.description} (${getEndpointDeviceSettings(endpoint.principalId)?.nickname ?? endpoint.displayName})`,
    })));
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
      description: `${resolved.tool.descriptor.description} Device: ${JSON.stringify(resolved.displayName)}; endpoint: ${JSON.stringify(resolved.endpointId)}. Do not substitute another device.${resolved.approvedArguments ? ` Single-call cross-device consent requires exactly these arguments: ${JSON.stringify(resolved.approvedArguments)}.` : ""}`,
      inputSchema: resolved.tool.descriptor.inputSchema,
      outputSchema: { type: 'object', properties: { content: resolved.tool.descriptor.name.endsWith('.device.get_location') ? { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', required: ['type', 'value'], properties: { type: { const: 'json' }, value: { type: 'object', required: ['source', 'purpose', 'data'] } } } } : resolved.tool.descriptor.outputSchema }, required: ['content'], additionalProperties: false },
      contractRevision: resolved.contractRevision,
      annotations: { readOnlyHint: resolved.tool.descriptor.effect === 'read',
        destructiveHint: resolved.tool.descriptor.effect === 'destructive', idempotentHint: resolved.tool.descriptor.idempotent },
      batchRead: resolved.tool.descriptor.effect === 'read' && resolved.tool.descriptor.sensitivity === 'public'
        && !resolved.tool.descriptor.requiresForeground && resolved.tool.descriptor.confirmation === 'never'
        && resolved.tool.descriptor.requiredPermissions.length === 0,
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
    const revision = context.contractRevision ?? resolved.contractRevision;
    let grantLease: ReturnType<NonNullable<EndpointToolRuntime['grants']>['reserve']> | undefined;
    const invoke = () => {
      context.signal?.throwIfAborted();
      if (this.resolve(toolRef)?.contractRevision !== revision) {
        throw new ExternalEffectNotAppliedError('Endpoint connection, binding or tool contract changed');
      }
      const turn = this.deps.getCurrentContext()!;
      const grant = this.deps.runtime.grants?.find(turn.conversationId, turn.origin, resolved.endpointId, resolved.tool.descriptor.name);
      if (grant) grantLease = this.deps.runtime.grants.reserve(grant.id, args);
      const signal = grantLease ? AbortSignal.any([grantLease.signal, context.signal ?? new AbortController().signal]) : context.signal;
      return this.deps.runtime.invocations.invoke({
      endpointId: resolved.endpointId,
      toolCallId: context.toolCallId,
      toolName: resolved.tool.descriptor.name,
      arguments: args,
      descriptorRevision: resolved.tool.revision,
      signal,
      onProgress: (progress) => {
        context.onUpdate?.({
          content: [{ type: 'text', text: progress.message ?? 'Endpoint tool is running' }],
          details: {
            endpointId: resolved.endpointId,
            ...(progress.percent === undefined ? {} : { percent: progress.percent }),
          },
        });
      },
      }).catch(error => {
        if (resolved.tool.descriptor.confirmation === 'always'
          && error instanceof EndpointToolExecutionError && error.code === 'USER_DENIED') {
          throw new ExternalEffectNotAppliedError(error.message, { cause: error });
        }
        throw error;
      });
    };
    try {
    const result = resolved.tool.descriptor.effect === 'read' ? await invoke() : await executeExternalOperation({
      principalId: resolved.principalId,
      capabilityId: toolRef,
      idempotencyKey: createHash('sha256').update(`${this.deps.getCurrentContext()?.conversationId}:${context.toolCallId}`).digest('hex'),
      requestDigest: createHash('sha256').update(canonicalCapabilityJson(args)).digest('hex'),
      descriptorDigest: resolved.tool.revision,
      surface: 'agent', recovery: 'manual',
    }, invoke);
    if (resolved.tool.descriptor.name.endsWith('.device.get_location')) {
      const signal = grantLease ? AbortSignal.any([grantLease.signal, context.signal ?? new AbortController().signal]) : context.signal;
      const summary = await processLocationTask(args, result.content, { endpointId: resolved.endpointId, principalId: resolved.principalId }, signal);
      signal?.throwIfAborted();
      const current = this.deps.runtime.registry.get(resolved.endpointId);
      if (!current || current.connectionId !== resolved.connectionId || current.availability !== 'foreground'
        || this.deps.runtime.registry.getTool(resolved.endpointId, resolved.tool.descriptor.name)?.revision !== resolved.tool.revision) {
        throw new ExternalEffectNotAppliedError('Location device connection or capability changed');
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary) }], structuredContent: JSON.parse(JSON.stringify({ content: [{ type: 'json', value: summary }] })),
        details: { endpointId: resolved.endpointId, endpointToolName: resolved.tool.descriptor.name, deviceObservation: summary } };
    }
    const observation = projectDeviceReading(resolved.tool.descriptor.name, resolved.endpointId, resolved.principalId, result.content, Date.now(), args);
    const files = result.content.filter((item) => item.type === 'file');
    return {
      content: observation ? [{ type: 'text', text: JSON.stringify(observation) }] : result.content.map((item) => ({ type: 'text' as const, text: contentText(item) })),
      structuredContent: JSON.parse(JSON.stringify({ content: result.content })),
      details: {
        ...(observation ? { deviceObservation: observation } : {}),
        endpointId: resolved.endpointId,
        endpointToolName: resolved.tool.descriptor.name,
        endpointSensitivity: resolved.tool.descriptor.sensitivity,
        ...(result.details ?? {}),
        ...(files.length === 0 ? {} : { endpointFiles: files }),
      },
    };
    } finally { grantLease?.complete(); }
  }

  private targetResolver() {
    return new DeviceTargetResolver(this.deps.runtime.registry, this.deps.runtime.bindings, this.deps.runtime.grants);
  }

  private resolve(toolRef: string) {
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed) return undefined;
    const context = this.deps.getCurrentContext();
    if (!context) return undefined;
    const endpoint = this.targetResolver().resolve(context.conversationId, context.origin, parsed.namespace, parsed.toolName);
    if (!endpoint || endpoint.endpointId !== parsed.namespace) return undefined;
    const tool = this.deps.runtime.registry.getTool(endpoint.endpointId, parsed.toolName);
    if (tool && [BROWSER_CONTROL_ENDPOINT_TOOL_NAME, COMPUTER_CONTROL_TOOL].includes(tool.descriptor.name)) return undefined;
    return tool ? { approvedArguments: this.deps.runtime.grants.find(context.conversationId, context.origin, endpoint.endpointId, parsed.toolName)?.arguments, connectionId: endpoint.connectionId, endpointId: endpoint.endpointId, principalId: endpoint.principalId, displayName: getEndpointDeviceSettings(endpoint.principalId)?.nickname ?? endpoint.displayName, tool,
      contractRevision: createHash('sha256').update(JSON.stringify([endpoint.principalId, endpoint.connectionId, tool.revision,
        this.deps.runtime.bindings.get(this.deps.getCurrentContext()!.conversationId)?.boundAt ?? null,
        this.deps.runtime.grants?.find(context.conversationId, context.origin, endpoint.endpointId, parsed.toolName)?.id ?? null])).digest('hex'),
    } : undefined;
  }
}

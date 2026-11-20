import { createHash } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CapabilityCallSchema, type CapabilityDescriptor } from '@xopcai/gateway-contract';

export function toolName(id: string): string {
  return id.replaceAll('.', '_');
}

export function describeTool(item: CapabilityDescriptor): Tool {
  const write = item.effect !== 'read';
  const inputSchema: Tool['inputSchema'] = { ...item.inputSchema, type: 'object' };
  if (write) {
    inputSchema.properties = {
      ...inputSchema.properties,
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 200,
        description: 'Choose one key for this write intent. Reuse it if the outcome is uncertain.' },
    };
    inputSchema.required = [...(inputSchema.required ?? []), 'idempotencyKey'];
  }
  return {
    name: toolName(item.id), description: item.description, inputSchema,
    outputSchema: { ...item.outputSchema, type: 'object' },
    annotations: { readOnlyHint: !write, destructiveHint: write,
      idempotentHint: write, openWorldHint: false },
  };
}

export function toolFailure(code: string, operationId?: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code, ...(operationId ? { operationId } : {}) }) }] };
}

export function toolResult(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
}

export function parseToolArguments(item: CapabilityDescriptor, args: Record<string, unknown> = {}) {
  const { idempotencyKey, ...input } = args;
  if (item.effect === 'read') return idempotencyKey === undefined ? { input } : undefined;
  const key = CapabilityCallSchema.shape.idempotencyKey.safeParse(idempotencyKey);
  return key.success && key.data?.trim() ? { input, idempotencyKey: key.data } : undefined;
}

export function scopedMcpIdempotencyKey(principalId: string, capabilityId: string, key?: string): string | undefined {
  // Domain-level deduplication must be isolated even when distinct callers choose the same key.
  return key?.trim() ? createHash('sha256').update(JSON.stringify([principalId, capabilityId, key])).digest('hex') : undefined;
}

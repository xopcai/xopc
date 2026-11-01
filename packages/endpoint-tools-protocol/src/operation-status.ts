import type { EndpointToolDescriptor } from './index.js';

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const time = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
export const DESKTOP_OPERATION_STATUS_INPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['operationId'], properties: { operationId: uuid } } as const;
export const DESKTOP_OPERATION_STATUS_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
    type: { const: 'json' }, value: { type: 'object', additionalProperties: false, required: ['operationId', 'status'], properties: {
      operationId: uuid, status: { enum: ['recorded', 'not-found'] }, receipt: { type: 'object', additionalProperties: false,
        required: ['operationId', 'state', 'updatedAt', 'executionStopped'], properties: { operationId: uuid,
          state: { enum: ['recorded', 'running', 'cancel-requested', 'succeeded', 'failed', 'stopped', 'unknown'] }, resultHash: digest,
          updatedAt: time, invocationId: uuid, connectionInstanceId: uuid, executionStopped: { type: 'boolean' } } },
    } },
  } },
} as const;
export function desktopOperationStatusDescriptor(): EndpointToolDescriptor {
  return { name: 'desktop.operation.get_status', title: 'Inspect a desktop operation',
    description: 'Read metadata for an existing operation on this explicitly selected device. Does not execute or retry it. Missing records do not prove that no effect occurred.',
    inputSchema: DESKTOP_OPERATION_STATUS_INPUT_SCHEMA, outputSchema: DESKTOP_OPERATION_STATUS_OUTPUT_SCHEMA,
    policyId: 'public.foreground-read', sensitivity: 'public', effect: 'read', confirmation: 'never', requiresForeground: true,
    requiredPermissions: [], timeoutMs: 5000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['json'] };
}

import type { EndpointToolDescriptor } from './index.js';

export const BRIDGE_RESOURCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['resourceId', 'name', 'measurement', 'unit', 'simulated'],
  properties: {
    resourceId: { type: 'string', pattern: '^[a-zA-Z0-9._:-]{1,128}$' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    measurement: { enum: ['temperature', 'humidity'] },
    unit: { enum: ['celsius', 'percent'] }, simulated: { type: 'boolean' },
  },
} as const;
export const BRIDGE_READ_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['resourceId'],
  properties: { resourceId: BRIDGE_RESOURCE_SCHEMA.properties.resourceId },
} as const;
function jsonOutput(value: Record<string, unknown>) {
  return { type: 'array', minItems: 1, maxItems: 1, items: {
    type: 'object', additionalProperties: false, required: ['type', 'value'],
    properties: { type: { const: 'json' }, value },
  } };
}
export const BRIDGE_LIST_OUTPUT_SCHEMA = jsonOutput({ type: 'array', maxItems: 100, items: BRIDGE_RESOURCE_SCHEMA });
export const BRIDGE_READ_OUTPUT_SCHEMA = jsonOutput({
  ...BRIDGE_RESOURCE_SCHEMA,
  required: [...BRIDGE_RESOURCE_SCHEMA.required, 'capturedAt', 'value'],
  properties: { ...BRIDGE_RESOURCE_SCHEMA.properties, capturedAt: { type: 'integer', minimum: 0 },
    value: { type: ['number', 'null'], minimum: -100, maximum: 200 } },
});

/** A Bridge uses the existing desktop host transport; each sensor retains its own resource ID. */
export function bridgeDescriptor(operation: 'list_resources' | 'read_sensor'): EndpointToolDescriptor {
  return {
    name: `desktop.bridge.${operation}`, title: operation === 'list_resources' ? 'Discover Bridge sensors' : 'Read a Bridge sensor',
    description: operation === 'list_resources'
      ? 'List bounded temperature and humidity resources on the explicitly selected Bridge. Each resource declares whether it is simulated.'
      : 'Read one fresh temperature or humidity sample by resourceId on the explicitly selected Bridge. Simulated samples are marked; unavailable values are null.',
    inputSchema: operation === 'list_resources' ? { type: 'object', properties: {}, additionalProperties: false } : BRIDGE_READ_INPUT_SCHEMA,
    outputSchema: operation === 'list_resources' ? BRIDGE_LIST_OUTPUT_SCHEMA : BRIDGE_READ_OUTPUT_SCHEMA,
    policyId: 'public.background-read', sensitivity: 'public', effect: 'read', confirmation: 'never',
    requiresForeground: false, requiredPermissions: [], timeoutMs: 10_000, maxConcurrency: 1,
    supportsCancellation: true, idempotent: true, resultKinds: ['json'],
  };
}

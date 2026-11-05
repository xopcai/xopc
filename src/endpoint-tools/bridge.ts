import { EndpointToolRegistry, type CapabilityProviderDefinition } from '@xopcai/endpoint-tools-client';
import type { ProviderTool } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

const resourceSchema = z.object({
  resourceId: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/), name: z.string().min(1).max(80),
  measurement: z.enum(['temperature', 'humidity']), unit: z.enum(['celsius', 'percent']), simulated: z.boolean(),
}).strict().refine(item => item.unit === (item.measurement === 'temperature' ? 'celsius' : 'percent'), 'Unit does not match measurement');
export type BridgeResource = z.infer<typeof resourceSchema>;
export interface BridgeSensorAdapter {
  resource: BridgeResource;
  read(signal: AbortSignal): Promise<{ value: number | null; capturedAt: number }>;
}

/** Drivers return one sample; transport, identity, cancellation and policy remain host-owned. */
export function createDeviceBridge(adapters: readonly BridgeSensorAdapter[], now = Date.now): EndpointToolRegistry {
  if (adapters.length > 100) throw new Error('Bridge supports at most 100 resources');
  const resources = new Map<string, { resource: BridgeResource; read: BridgeSensorAdapter['read'] }>();
  for (const adapter of adapters) {
    const resource = resourceSchema.parse(adapter.resource);
    if (resources.has(resource.resourceId)) throw new Error('Duplicate Bridge resource ID');
    resources.set(resource.resourceId, { resource, read: adapter.read.bind(adapter) });
  }
  const descriptor = (name: string, description: string, inputSchema: Record<string, unknown>): ProviderTool => ({
    name, title: name === 'list_resources' ? 'Discover sensors' : 'Read sensor', description, inputSchema,
    effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false, requiredPermissions: [],
    timeoutMs: 10_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['json'],
  });
  const definitions: CapabilityProviderDefinition['tools'] = [
    { descriptor: descriptor('list_resources', 'List temperature and humidity sensors with stable resource IDs and simulation labels.', { type: 'object', additionalProperties: false }), execute: async args => {
      z.object({}).strict().parse(args);
      return { content: [{ type: 'json', value: [...resources.values()].map(item => ({ ...item.resource })) }] };
    } },
    { descriptor: descriptor('read_sensor', 'Read a fresh temperature or humidity sample by resourceId. Simulated samples are marked; unavailable values are null.', { type: 'object', properties: { resourceId: { type: 'string', maxLength: 128 } }, required: ['resourceId'], additionalProperties: false }), execute: async (args, context) => {
      const { resourceId } = z.object({ resourceId: z.string() }).strict().parse(args);
      const adapter = resources.get(resourceId);
      if (!adapter) throw new TypeError('Unknown Bridge resource');
      context.signal.throwIfAborted();
      const sample = await adapter.read(context.signal);
      context.signal.throwIfAborted();
      const time = now();
      if (!Number.isSafeInteger(sample.capturedAt) || sample.capturedAt > time + 60_000 || sample.capturedAt < time - 30_000) {
        throw new TypeError('Bridge sample has an invalid or stale timestamp');
      }
      const { value } = sample;
      const range = adapter.resource.measurement === 'humidity' ? [0, 100] : [-100, 200];
      if (value !== null && (!Number.isFinite(value) || value < range[0] || value > range[1])) throw new TypeError('Invalid Bridge sample value');
      return { content: [{ type: 'json', value: { ...adapter.resource, value, capturedAt: sample.capturedAt } }] };
    } },
  ];
  const registry = new EndpointToolRegistry([]);
  registry.registerProvider({ localId: 'sensors', title: 'Environment sensors', summary: 'Read connected temperature and humidity sensors', tools: definitions });
  return registry;
}

export function simulatedEnvironmentSensors(now = Date.now): BridgeSensorAdapter[] {
  return [
    { resource: { resourceId: 'sim.room.temperature', name: 'Simulated room temperature', measurement: 'temperature', unit: 'celsius', simulated: true },
      read: async () => ({ value: 23.5, capturedAt: now() }) },
    { resource: { resourceId: 'sim.room.humidity', name: 'Simulated room humidity', measurement: 'humidity', unit: 'percent', simulated: true },
      read: async () => ({ value: 45, capturedAt: now() }) },
  ];
}

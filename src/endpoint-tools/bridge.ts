import { EndpointToolRegistry, type EndpointToolDefinition } from '@xopcai/endpoint-tools-client';
import { bridgeDescriptor } from '@xopcai/endpoint-tools-protocol';
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
  const definitions: EndpointToolDefinition[] = [
    { descriptor: bridgeDescriptor('list_resources'), execute: async args => {
      z.object({}).strict().parse(args);
      return { content: [{ type: 'json', value: [...resources.values()].map(item => ({ ...item.resource })) }] };
    } },
    { descriptor: bridgeDescriptor('read_sensor'), execute: async (args, context) => {
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
  return new EndpointToolRegistry(definitions);
}

export function simulatedEnvironmentSensors(now = Date.now): BridgeSensorAdapter[] {
  return [
    { resource: { resourceId: 'sim.room.temperature', name: 'Simulated room temperature', measurement: 'temperature', unit: 'celsius', simulated: true },
      read: async () => ({ value: 23.5, capturedAt: now() }) },
    { resource: { resourceId: 'sim.room.humidity', name: 'Simulated room humidity', measurement: 'humidity', unit: 'percent', simulated: true },
      read: async () => ({ value: 45, capturedAt: now() }) },
  ];
}

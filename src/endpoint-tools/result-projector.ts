import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

/** Only fixed bounded state contracts are retained; personal tools use their existing policies. */
export function projectDeviceReading(toolName: string, endpointId: string, principalId: string,
  content: EndpointToolContent[], receivedAt = Date.now(), args?: Record<string, unknown>) {
  const sensor = toolName === 'desktop.bridge.read_sensor';
  if (!sensor && !/^(mobile|desktop|web|browser)\.device\.get_(state|power)$/.test(toolName)) return undefined;
  const item = content[0];
  if (item?.type !== 'json' || !item.value || typeof item.value !== 'object') throw new Error('Invalid device reading');
  if (sensor) {
    const reading = item.value as Record<string, unknown>;
    if (reading.resourceId !== args?.resourceId) throw new Error('Bridge returned a different resource');
    const expectedUnit = reading.measurement === 'humidity' ? 'percent' : 'celsius';
    if (reading.unit !== expectedUnit || (reading.measurement === 'humidity' && reading.value !== null
      && (typeof reading.value !== 'number' || reading.value < 0 || reading.value > 100))) throw new Error('Invalid Bridge measurement');
  }
  const capturedAt = (item.value as { capturedAt?: unknown }).capturedAt;
  if (typeof capturedAt !== 'number' || !Number.isSafeInteger(capturedAt)
    || capturedAt > receivedAt + 60_000 || capturedAt < receivedAt - 30_000) throw new Error('Device sample is stale or has an invalid clock');
  return { version: 1, source: { endpointId, principalId, ...(sensor ? { resourceId: (item.value as Record<string, unknown>).resourceId } : {}) }, capturedAt, receivedAt,
    validUntil: Math.min(receivedAt, capturedAt) + 30_000, cached: false, data: item.value };
}

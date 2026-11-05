import type { EndpointToolContent } from '@xopcai/endpoint-tools-protocol';

/** Only fixed bounded state contracts are retained; personal tools use their existing policies. */
export function projectDeviceReading(toolName: string, endpointId: string, principalId: string,
  content: EndpointToolContent[], receivedAt = Date.now()) {
  if (!/^(mobile|desktop|web|browser)\.device\.get_(state|power)$/.test(toolName)) return undefined;
  const item = content[0];
  if (item?.type !== 'json' || !item.value || typeof item.value !== 'object') throw new Error('Invalid device reading');
  const capturedAt = (item.value as { capturedAt?: unknown }).capturedAt;
  if (typeof capturedAt !== 'number' || !Number.isSafeInteger(capturedAt)
    || capturedAt > receivedAt + 60_000 || capturedAt < receivedAt - 30_000) throw new Error('Device sample is stale or has an invalid clock');
  return { version: 1, source: { endpointId, principalId }, capturedAt, receivedAt,
    validUntil: Math.min(receivedAt, capturedAt) + 30_000, cached: false, data: item.value };
}

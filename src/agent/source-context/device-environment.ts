import { projectEndpointContextView, locationShareSummarySchema } from '@xopcai/endpoint-tools-protocol';

import type { AgentSourceContext } from './types.js';

/** Frozen message provenance stays fixed; expired environment values are not model inputs. */
export function deviceEnvironmentText(context: AgentSourceContext, now = Date.now()): string {
  if (context.kind !== 'device_context') return context.text.trim();
  try {
    const data = JSON.parse(context.text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return context.text.trim();
    if (Array.isArray(data.locationShares)) {
      data.locationShares = data.locationShares.slice(0, 3).flatMap((value: unknown) => {
        const parsed = locationShareSummarySchema.safeParse(value);
        if (!parsed.success || parsed.data.endpointId !== context.sourceId) return [];
        const share = parsed.data;
        if (share.expiresAt <= now || (share.validUntil ?? 0) <= now || share.status !== 'fresh') {
          delete share.valueRef; if (share.status === 'fresh') share.status = 'stale';
        }
        return [share];
      });
    } else delete data.locationShares;
    if (data.taskContext) {
      const view = projectEndpointContextView(data.taskContext, context.sourceId, now);
      if (view) data.taskContext = { ...view, evaluatedAt: now };
      else delete data.taskContext;
    }
    if (data.environment && (typeof data.environment.capturedAt !== 'number'
      || data.environment.capturedAt < now - 300_000 || data.environment.capturedAt > now + 60_000)) delete data.environment;
    return JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  } catch { return context.text.trim(); }
}

import { emitGatewayEvent } from './gateway-event-bus';

/**
 * Parse gateway `/api/events` payloads and fan out to in-app subscribers (RN-safe; no `window`).
 */
export function dispatchGatewaySseEvent(eventName: string, rawData: string): void {
  let detail: unknown = rawData;
  try {
    detail = JSON.parse(rawData) as unknown;
  } catch {
    /* keep raw string */
  }

  emitGatewayEvent(eventName, detail);

  if (eventName === 'agent.stream' && detail && typeof detail === 'object' && detail !== null) {
    const d = detail as { sessionKey?: string; event?: unknown };
    if (typeof d.sessionKey === 'string' && d.sessionKey.length > 0) {
      emitGatewayEvent('agent-stream', {
        sessionKey: d.sessionKey,
        event: d.event !== undefined ? d.event : d,
      });
    }
  }

  if (eventName === 'session.updated' && detail && typeof detail === 'object' && detail !== null) {
    const d = detail as { key?: string };
    if (typeof d.key === 'string' && d.key.length > 0) {
      emitGatewayEvent('session-updated', { key: d.key });
    }
  }
}

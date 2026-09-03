import { useEffect } from 'react';

import { useGatewayStore } from '../../stores/gateway-store';
import { AgentMessageSender } from '../../api/agent-client';

import { subscribeGatewayEvent } from './gateway-event-bus';
import { listPendingSessionInputKeys } from './session-input-outbox';

const sender = new AgentMessageSender();
let flushing = false;

async function flushPendingInputs(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const gatewayId = useGatewayStore.getState().activeGatewayId;
  try {
    for (const sessionKey of listPendingSessionInputKeys()) {
      if (useGatewayStore.getState().activeGatewayId !== gatewayId) break;
      try {
        await sender.flushPendingMessage(sessionKey);
      } catch {
        // The outbox remains durable; the next connectivity event retries it.
      }
    }
  } finally {
    flushing = false;
    if (useGatewayStore.getState().activeGatewayId !== gatewayId) void flushPendingInputs();
  }
}

/** Flushes every session outbox when the shared realtime route is usable. */
export function useSessionInputOutboxFlush(): void {
  useEffect(() => subscribeGatewayEvent('gateway.realtime-connected', () => {
    void flushPendingInputs();
  }), []);
}

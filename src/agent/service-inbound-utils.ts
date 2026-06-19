import { randomUUID } from 'node:crypto';

import type { InboundMessage } from '../infra/bus/index.js';

export function inboundMessageLogRequestId(msg: InboundMessage): string {
  const raw = msg.metadata?.requestId;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return randomUUID();
}

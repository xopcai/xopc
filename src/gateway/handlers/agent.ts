import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { createEvent, type GatewayEvent, type RequestContext } from '../protocol.js';

const log = createLogger('Gateway:AgentHandler');

export async function* handleAgent(
  params: Record<string, unknown>,
  _ctx: RequestContext
): AsyncGenerator<GatewayEvent, { status: string; summary: string }, unknown> {
  const message = params.message as string;
  
  if (!message) {
    throw new Error('Missing required param: message');
  }

  log.info({ message: message.slice(0, 100) }, 'Starting agent run');

  // Send initial status event
  yield createEvent('agent', {
    type: 'status',
    status: 'accepted',
    runId: crypto.randomUUID(),
  });

  // Simulate streaming output (placeholder for real agent integration)
  yield createEvent('agent', {
    type: 'token',
    content: 'Processing your request...\n',
  });

  // Yield control back to allow interruption
  await new Promise((resolve) => setTimeout(resolve, 100));

  yield createEvent('agent', {
    type: 'token',
    content: 'Agent response would appear here.\n',
  });

  // Return final result
  return {
    status: 'ok',
    summary: `Processed: ${message.slice(0, 50)}...`,
  };
}

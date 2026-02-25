/**
 * Diagnostic Events System
 * 
 * Structured event stream for system diagnostics:
 * - Webhook events (received, processed, error)
 * - Message events (queued, processed)
 * - Session events (state changes, stuck detection)
 * - Model usage events (tokens, cost, duration)
 * - Heartbeat events (system health)
 * 
 * Based on OpenClaw's diagnostic-events.ts implementation.
 */

import { createRequire } from 'node:module';

const requireConfig = createRequire(import.meta.url);

// =============================================================================
// Types
// =============================================================================

export type DiagnosticSessionState = 'idle' | 'processing' | 'waiting';

// Base event structure
type DiagnosticBaseEvent = {
  ts: number;
  seq: number;
};

// ====================
// Webhook Events
// ====================

export type DiagnosticWebhookReceivedEvent = DiagnosticBaseEvent & {
  type: 'webhook.received';
  channel: string;
  updateType?: string;
  chatId?: number | string;
};

export type DiagnosticWebhookProcessedEvent = DiagnosticBaseEvent & {
  type: 'webhook.processed';
  channel: string;
  updateType?: string;
  chatId?: number | string;
  durationMs?: number;
};

export type DiagnosticWebhookErrorEvent = DiagnosticBaseEvent & {
  type: 'webhook.error';
  channel: string;
  updateType?: string;
  chatId?: number | string;
  error: string;
};

// ====================
// Message Events
// ====================

export type DiagnosticMessageQueuedEvent = DiagnosticBaseEvent & {
  type: 'message.queued';
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  source: string;
  queueDepth?: number;
};

export type DiagnosticMessageProcessedEvent = DiagnosticBaseEvent & {
  type: 'message.processed';
  channel: string;
  messageId?: number | string;
  chatId?: number | string;
  sessionKey?: string;
  sessionId?: string;
  durationMs?: number;
  outcome: 'completed' | 'skipped' | 'error';
  reason?: string;
  error?: string;
};

// ====================
// Session Events
// ====================

export type DiagnosticSessionStateEvent = DiagnosticBaseEvent & {
  type: 'session.state';
  sessionKey?: string;
  sessionId?: string;
  prevState?: DiagnosticSessionState;
  state: DiagnosticSessionState;
  reason?: string;
  queueDepth?: number;
};

export type DiagnosticSessionStuckEvent = DiagnosticBaseEvent & {
  type: 'session.stuck';
  sessionKey?: string;
  sessionId?: string;
  state: DiagnosticSessionState;
  ageMs: number;
  queueDepth?: number;
};

// ====================
// Queue Events
// ====================

export type DiagnosticLaneEnqueueEvent = DiagnosticBaseEvent & {
  type: 'queue.lane.enqueue';
  lane: string;
  queueSize: number;
};

export type DiagnosticLaneDequeueEvent = DiagnosticBaseEvent & {
  type: 'queue.lane.dequeue';
  lane: string;
  queueSize: number;
  waitMs: number;
};

// ====================
// Run Events
// ====================

export type DiagnosticRunAttemptEvent = DiagnosticBaseEvent & {
  type: 'run.attempt';
  sessionKey?: string;
  sessionId?: string;
  runId: string;
  attempt: number;
};

// ====================
// Model Usage Events
// ====================

export type DiagnosticModelUsageEvent = DiagnosticBaseEvent & {
  type: 'model.usage';
  sessionKey?: string;
  sessionId?: string;
  channel?: string;
  provider?: string;
  model?: string;
  usage: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    promptTokens?: number;
    total?: number;
  };
  context?: {
    limit?: number;
    used?: number;
  };
  costUsd?: number;
  durationMs?: number;
};

// ====================
// Heartbeat Event
// ====================

export type DiagnosticHeartbeatEvent = DiagnosticBaseEvent & {
  type: 'diagnostic.heartbeat';
  webhooks: {
    received: number;
    processed: number;
    errors: number;
  };
  active: number;
  waiting: number;
  queued: number;
};

// ====================
// Union Type
// ====================

export type DiagnosticEventPayload =
  | DiagnosticWebhookReceivedEvent
  | DiagnosticWebhookProcessedEvent
  | DiagnosticWebhookErrorEvent
  | DiagnosticMessageQueuedEvent
  | DiagnosticMessageProcessedEvent
  | DiagnosticSessionStateEvent
  | DiagnosticSessionStuckEvent
  | DiagnosticLaneEnqueueEvent
  | DiagnosticLaneDequeueEvent
  | DiagnosticRunAttemptEvent
  | DiagnosticModelUsageEvent
  | DiagnosticHeartbeatEvent;

export type DiagnosticEventInput = DiagnosticEventPayload extends infer Event
  ? Event extends DiagnosticEventPayload
    ? Omit<Event, 'seq' | 'ts'>
    : never
  : never;

// =============================================================================
// Internal State
// =============================================================================

let seq = 0;
const listeners = new Set<(evt: DiagnosticEventPayload) => void>();

// =============================================================================
// Configuration
// =============================================================================

function isDiagnosticsEnabled(): boolean {
  try {
    const loaded = requireConfig('../config/config.js') as {
      loadConfig?: () => { diagnostics?: { enabled?: boolean } };
    };
    return loaded.loadConfig?.()?.diagnostics?.enabled === true;
  } catch {
    return false;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if diagnostics are enabled
 */
export function diagnosticsEnabled(): boolean {
  return isDiagnosticsEnabled();
}

/**
 * Emit a diagnostic event
 * 
 * @param event - Event to emit (without seq/ts)
 */
export function emitDiagnosticEvent(event: DiagnosticEventInput): void {
  // Always emit even if diagnostics disabled (for internal use)
  // but could be gated if needed
  
  const enriched = {
    ...event,
    seq: (seq += 1),
    ts: Date.now(),
  } satisfies DiagnosticEventPayload;
  
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      // Ignore listener failures
    }
  }
}

/**
 * Subscribe to diagnostic events
 * 
 * @param listener - Callback function
 * @returns Unsubscribe function
 */
export function onDiagnosticEvent(listener: (evt: DiagnosticEventPayload) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get the number of subscribers
 */
export function getSubscriberCount(): number {
  return listeners.size;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Log webhook received
 */
export function logWebhookReceived(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
}): void {
  emitDiagnosticEvent({
    type: 'webhook.received',
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
  });
}

/**
 * Log webhook processed
 */
export function logWebhookProcessed(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
  durationMs?: number;
}): void {
  emitDiagnosticEvent({
    type: 'webhook.processed',
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
    durationMs: params.durationMs,
  });
}

/**
 * Log webhook error
 */
export function logWebhookError(params: {
  channel: string;
  updateType?: string;
  chatId?: number | string;
  error: string;
}): void {
  emitDiagnosticEvent({
    type: 'webhook.error',
    channel: params.channel,
    updateType: params.updateType,
    chatId: params.chatId,
    error: params.error,
  });
}

/**
 * Log message queued
 */
export function logMessageQueued(params: {
  sessionId?: string;
  sessionKey?: string;
  channel?: string;
  source: string;
}): void {
  emitDiagnosticEvent({
    type: 'message.queued',
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    channel: params.channel,
    source: params.source,
  });
}

/**
 * Log message processed
 */
export function logMessageProcessed(params: {
  channel: string;
  messageId?: number | string;
  chatId?: number | string;
  sessionId?: string;
  sessionKey?: string;
  durationMs?: number;
  outcome: 'completed' | 'skipped' | 'error';
  reason?: string;
  error?: string;
}): void {
  emitDiagnosticEvent({
    type: 'message.processed',
    channel: params.channel,
    messageId: params.messageId,
    chatId: params.chatId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    durationMs: params.durationMs,
    outcome: params.outcome,
    reason: params.reason,
    error: params.error,
  });
}

/**
 * Log model usage
 */
export function logModelUsage(params: {
  sessionId?: string;
  sessionKey?: string;
  channel?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  durationMs?: number;
}): void {
  emitDiagnosticEvent({
    type: 'model.usage',
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    channel: params.channel,
    provider: params.provider,
    model: params.model,
    usage: {
      input: params.inputTokens,
      output: params.outputTokens,
      cacheRead: params.cacheReadTokens,
      cacheWrite: params.cacheWriteTokens,
    },
    costUsd: params.costUsd,
    durationMs: params.durationMs,
  });
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Reset diagnostic events (for testing)
 */
export function resetDiagnosticEventsForTest(): void {
  seq = 0;
  listeners.clear();
}

export default {
  emitDiagnosticEvent,
  onDiagnosticEvent,
  diagnosticsEnabled,
  logWebhookReceived,
  logWebhookProcessed,
  logWebhookError,
  logMessageQueued,
  logMessageProcessed,
  logModelUsage,
  resetDiagnosticEventsForTest,
};

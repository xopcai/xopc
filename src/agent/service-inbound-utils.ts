import { randomUUID } from 'node:crypto';

import type { InboundMessage } from '../infra/bus/index.js';

export function inboundMessageLogRequestId(msg: InboundMessage): string {
  const raw = msg.metadata?.requestId;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return randomUUID();
}

/** Cap tool result size in SSE `tool_end` events (pi-agent passes structured objects, not only strings). */
const SSE_TOOL_RESULT_MAX_CHARS = 100_000;

export function serializeAgentToolResultForSse(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') {
    return result.length > SSE_TOOL_RESULT_MAX_CHARS
      ? `${result.slice(0, SSE_TOOL_RESULT_MAX_CHARS)}\n…(truncated)`
      : result;
  }
  try {
    const s = JSON.stringify(result, null, 2);
    return s.length > SSE_TOOL_RESULT_MAX_CHARS
      ? `${s.slice(0, SSE_TOOL_RESULT_MAX_CHARS)}\n…(truncated)`
      : s;
  } catch {
    try {
      return String(result);
    } catch {
      return undefined;
    }
  }
}

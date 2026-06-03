import { serializeAgentToolResultForSse } from '../service-inbound-utils.js';
import type { EmbeddedStreamEvent } from './types.js';

export type GatewaySseEvent = { type: string; [key: string]: unknown };

/** Map embedded pi events to gateway / webchat SSE shape. */
export function mapEmbeddedEventToGatewaySse(event: EmbeddedStreamEvent): GatewaySseEvent | null {
  switch (event.type) {
    case 'token':
      return { type: 'token', content: event.content };
    case 'thinking':
      return event.status
        ? { type: 'thinking', status: event.status }
        : { type: 'thinking', content: event.content, delta: true };
    case 'tool_start':
      return {
        type: 'tool_start',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: event.args,
      };
    case 'tool_end':
      return {
        type: 'tool_end',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        result: event.result,
      };
    case 'tool_update':
      return {
        type: 'tool_update',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        details: event.details,
      };
    case 'message_end':
      return { type: 'message_end' };
    case 'progress':
      return { type: 'progress', stage: event.stage, message: event.message };
    case 'compaction':
      return {
        type: 'compaction',
        status: event.status,
        tokensBefore: event.tokensBefore,
        tokensAfter: event.tokensAfter,
        summary: event.summary,
      };
    case 'error':
      return { type: 'error', content: event.content };
    default:
      return null;
  }
}

export function mapEmbeddedToolEndResult(
  result: unknown,
): ReturnType<typeof serializeAgentToolResultForSse> {
  return serializeAgentToolResultForSse(result);
}

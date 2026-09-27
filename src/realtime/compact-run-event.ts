import type { RealtimeDelivery } from './broker.js';
import type { ChatStreamEvent } from '../gateway/chat-stream/protocol.js';
import { conciseProgress } from '../session/compact-history.js';

/** Keep the original sequence watermark, including across omitted diagnostic events. */
export function compactRunEvent(message: RealtimeDelivery): RealtimeDelivery | null {
  if (message.kind !== 'realtime.event' || !message.payload.topic.startsWith('run:')) return message;
  const event = message.payload.data as ChatStreamEvent;
  let payload: unknown = event.payload;
  switch (event.type) {
    case 'tool_end':
      if (!event.payload.deliveries?.length || event.payload.status !== 'success') return null;
      payload = { deliveries: event.payload.deliveries };
      break;
    case 'progress':
      if (!event.payload.petFeedback.publicSummary) return null;
      payload = { message: conciseProgress(event.payload.petFeedback.publicSummary) };
      break;
    case 'turn_outcome':
      payload = { ...event.payload, evidence: [], changeSet: undefined };
      break;
    case 'user_message': payload = {}; break;
    case 'run_start': case 'run_end': case 'assistant_delta': case 'assistant_message_end':
    case 'error': case 'clarify_request': case 'session_config_updated': case 'tts_audio': case 'review': break;
    default: return null;
  }
  return { ...message, payload: { ...message.payload, data: { ...event, payload } } };
}

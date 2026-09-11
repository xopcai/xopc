import { describe, expect, it } from 'vitest';

import {
  acknowledgeLocalSessionInputs,
  failLocalMessageIfSending,
  setLocalMessageDeliveryState,
} from '../local-messages-store';
import type { Message } from '../messages.types';

function localMessage(id: string, deliveryState: Message['deliveryState']): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: id }],
    deliveryState,
  };
}

describe('local message delivery state', () => {
  it('marks the matching optimistic message as sent after an HTTP acknowledgement', () => {
    const sending = localMessage('message-a', 'sending');
    const other = localMessage('message-b', 'sending');

    expect(setLocalMessageDeliveryState([sending, other], 'message-a', 'sent')).toEqual([
      { ...sending, deliveryState: 'sent' },
      other,
    ]);
  });

  it('uses session input-state as an independent gateway acknowledgement', () => {
    const sending = localMessage('message-a', 'sending');
    const failed = localMessage('message-b', 'failed');

    expect(acknowledgeLocalSessionInputs([sending, failed], [
      { clientMessageId: 'message-a', status: 'running' },
      { clientMessageId: 'message-b', status: 'queued' },
    ])).toEqual([
      { ...sending, deliveryState: 'sent' },
      { ...failed, deliveryState: 'sent' },
    ]);
  });

  it('preserves identity when an acknowledgement has no matching local message', () => {
    const messages = [localMessage('message-a', 'sending')];
    expect(acknowledgeLocalSessionInputs(messages, [{ clientMessageId: 'other' }])).toBe(messages);
    expect(acknowledgeLocalSessionInputs(messages, null)).toBe(messages);
  });

  it('does not downgrade a realtime acknowledgement when the HTTP response fails later', () => {
    const accepted = [localMessage('message-a', 'sent')];
    expect(failLocalMessageIfSending(accepted, 'message-a')).toBe(accepted);

    const sending = [localMessage('message-a', 'sending')];
    expect(failLocalMessageIfSending(sending, 'message-a')).toEqual([
      { ...sending[0], deliveryState: 'failed' },
    ]);
  });
});

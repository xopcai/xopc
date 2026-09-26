import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = vi.hoisted(() => new Map<string, string>());
vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => values.get(key),
    set: (key: string, value: string | number | boolean) => values.set(key, String(value)),
    delete: (key: string) => values.delete(key),
  },
}));

import {
  confirmOutboxMessages,
  readMessageOutbox,
  upsertMessageOutbox,
} from '../message-outbox';
import type { MessageSubmission } from '../message-submission';

beforeEach(() => values.clear());

function submission(clientMessageId: string): MessageSubmission {
  return {
    clientMessageId,
    gatewayId: 'gateway-1',
    conversationId: 'conversation-1',
    content: 'hello',
    delivery: 'next',
    attachments: [],
    contextRefs: [],
  };
}

describe('message outbox', () => {
  it('keeps the same client id while updating an attempt', () => {
    upsertMessageOutbox('scope', submission('client-1'), 'sending', 10);
    upsertMessageOutbox('scope', { ...submission('client-1'), expectedTranscriptId: 'transcript-1' }, 'confirming', 20);

    expect(readMessageOutbox('scope')).toEqual([
      expect.objectContaining({
        createdAt: 10,
        deliveryState: 'confirming',
        submission: expect.objectContaining({
          clientMessageId: 'client-1',
          expectedTranscriptId: 'transcript-1',
        }),
      }),
    ]);
  });

  it('drops inline attachment data when a replayable native URI exists', () => {
    const value = submission('client-1');
    value.attachments = [{
      type: 'image',
      data: 'very-large-base64',
      localUri: 'file:///image.jpg',
      mimeType: 'image/jpeg',
    }];
    upsertMessageOutbox('scope', value, 'sending');

    expect(readMessageOutbox('scope')[0]?.submission.attachments).toEqual([{
      type: 'image',
      localUri: 'file:///image.jpg',
      mimeType: 'image/jpeg',
    }]);
  });

  it('removes only ids confirmed by durable server history', () => {
    upsertMessageOutbox('scope', submission('client-1'), 'confirming');
    upsertMessageOutbox('scope', submission('client-2'), 'confirming');
    confirmOutboxMessages('scope', ['client-1']);
    expect(readMessageOutbox('scope').map(row => row.submission.clientMessageId)).toEqual(['client-2']);
  });
});

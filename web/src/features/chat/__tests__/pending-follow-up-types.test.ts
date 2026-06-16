import { describe, expect, it } from 'vitest';

import type { PendingFollowUpAttachment } from '@/features/chat/follow-up/pending-follow-up.types';

describe('pending follow-up attachment wire', () => {
  it('allows session-backed attachment rows with uri (no base64 data)', () => {
    const row: PendingFollowUpAttachment = {
      type: 'document',
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 0,
      uri: 'media://inbound/a---uuid.txt',
    };
    expect(row.uri).toBe('media://inbound/a---uuid.txt');
  });
});

import { describe, it, expect } from 'vitest';

import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';

describe('PendingFollowUp', () => {
  it('allows session-backed attachment rows with workspaceRelativePath (no base64 data)', () => {
    const row: PendingFollowUp = {
      id: '1',
      text: 'Check file',
      attachments: [
        { type: 'document', name: 'a.txt', mimeType: 'text/plain', size: 0, workspaceRelativePath: 'inbound/a.txt' },
      ],
    };
    expect(row.attachments![0].workspaceRelativePath).toBe('inbound/a.txt');
  });
});

import { describe, expect, it } from 'vitest';

import { buildDefaultSessionMetadata } from '../session-metadata.js';
import { metadataToSessionInsert } from '../row-mappers.js';

describe('metadataToSessionInsert', () => {
  it('requires an explicit agent', () => {
    expect(() => metadataToSessionInsert('06e49449-6c47-45c3-868a-753193a8262a', 'transcript', buildDefaultSessionMetadata('06e49449-6c47-45c3-868a-753193a8262a'))).toThrow(/explicit agent/);
  });

  it('keeps explicit routing agent id as the source of truth', () => {
    const conversationId = '06e49449-6c47-45c3-868a-753193a8262a';
    const row = metadataToSessionInsert(
      conversationId,
      'session-id',
      buildDefaultSessionMetadata(conversationId, {
        routing: { agentId: 'MAIN', source: 'webchat' },
      }),
    );

    expect(row.agentId).toBe('main');
  });
});

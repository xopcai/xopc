import { describe, expect, it } from 'vitest';

import { buildDefaultSessionMetadata } from '../session-metadata.js';
import { metadataToSessionInsert } from '../row-mappers.js';

describe('metadataToSessionInsert', () => {
  it('falls back to the agent id encoded in agent session keys', () => {
    const sessionKey = 'agent:coder:tui-test';
    const row = metadataToSessionInsert(
      sessionKey,
      'session-id',
      buildDefaultSessionMetadata(sessionKey),
    );

    expect(row.agentId).toBe('coder');
  });

  it('keeps explicit routing agent id as the source of truth', () => {
    const sessionKey = 'agent:coder:tui-test';
    const row = metadataToSessionInsert(
      sessionKey,
      'session-id',
      buildDefaultSessionMetadata(sessionKey, {
        routing: { agentId: 'MAIN', source: 'webchat' },
      }),
    );

    expect(row.agentId).toBe('main');
  });
});

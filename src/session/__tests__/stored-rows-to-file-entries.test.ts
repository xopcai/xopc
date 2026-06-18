import { describe, expect, it } from 'vitest';

import { storedRowsToFileEntries } from '../stored-rows-to-file-entries.js';

describe('storedRowsToFileEntries', () => {
  it('hydrates extension custom rows into pi custom entries', () => {
    const entries = storedRowsToFileEntries({
      sessionId: 'session-1',
      cwd: '/repo',
      rows: [
        { type: 'custom', customType: 'preset-state', data: { enabled: true } },
        {
          role: 'custom',
          customType: 'status-update',
          content: [{ type: 'text', text: 'ready' }],
          display: false,
          details: { phase: 'index' },
          timestamp: 1_700_000_000_000,
        },
      ],
    });

    expect(entries[1]).toMatchObject({
      type: 'custom',
      customType: 'preset-state',
      data: { enabled: true },
    });
    expect(entries[2]).toMatchObject({
      type: 'custom_message',
      customType: 'status-update',
      content: [{ type: 'text', text: 'ready' }],
      display: false,
      details: { phase: 'index' },
      timestamp: new Date(1_700_000_000_000).toISOString(),
    });
  });
});

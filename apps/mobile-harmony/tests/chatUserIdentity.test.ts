import { describe, expect, it } from 'vitest';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol.ets';

describe('stable user message presentation identity', () => {
  it('uses the input identity only for user messages and preserves legacy fallbacks', () => {
    const rows = historyRows({ session: { key: 's', messages: [
      { id: 'server-a', role: 'user', content: 'same', metadata: { clientMessageId: 'input-a' } },
      { id: 'server-b', role: 'user', content: 'same', metadata: { clientMessageId: 'input-b' } },
      { id: 'legacy', role: 'user', content: 'old', metadata: { clientMessageId: ' ' } },
      { id: 'assistant', role: 'assistant', content: 'reply', metadata: { clientMessageId: 'input-a' } },
    ] }, pagination: { hasMore: false } });
    expect(rows.map(row => row.id)).toEqual(['input-a', 'input-b', 'legacy', 'assistant']);
  });
});

// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { clearPendingSessionCommand, readPendingSessionCommand, savePendingSessionCommand, type PendingSessionCommand } from '../session/local-session-drafts';

vi.stubGlobal('indexedDB', new IDBFactory());
const command = (clientMessageId: string): PendingSessionCommand => ({
  kind: 'append', clientMessageId, expectedTranscriptId: 'transcript', configVersion: 1,
  delivery: 'next', input: { content: 'follow-up' },
});
describe('pending command acknowledgement', () => {
  it('cannot erase a newer window submission when an older receipt arrives late', async () => {
    useGatewayStore.setState({ conversationId: 'receipt-cas-test' });
    await savePendingSessionCommand('conversation', command('old'));
    await clearPendingSessionCommand('conversation', 'old');
    await savePendingSessionCommand('conversation', command('new'));
    await clearPendingSessionCommand('conversation', 'old');
    expect(await readPendingSessionCommand('conversation')).toEqual(command('new'));
    await clearPendingSessionCommand('conversation', 'new');
    expect(await readPendingSessionCommand('conversation')).toBeUndefined();
  });
});

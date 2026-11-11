import { describe, expect, it, vi } from 'vitest';

import { confirmChannelConnectionProbe, getChannelConnectionClaimant, getChannelConnectionProbe, handleChannelConnectionProbe, startChannelConnectionProbe } from '../connection-probe.js';

describe('channel setup verification', () => {
  it('checks the bot identity, waits for a reply, and requires Telegram owner confirmation', async () => {
    const probe = startChannelConnectionProbe({ channel: 'telegram', accountId: 'account', botUsername: 'test_bot', identity: '5', confirmOwner: true, zh: false });
    if (probe.type !== 'qr') throw new Error('Expected a verification QR');
    const code = new URL(probe.qrPayload!).searchParams.get('start');
    const reply = vi.fn().mockRejectedValueOnce(new Error('send failed')).mockResolvedValue(undefined);
    const inbound = { channel: 'telegram', accountId: 'account', senderId: '42', text: '/start ' + code, reply };
    await handleChannelConnectionProbe({ ...inbound, identity: 'other' });
    expect(reply).not.toHaveBeenCalled();
    await expect(handleChannelConnectionProbe({ ...inbound, identity: '5' })).rejects.toThrow('send failed');
    expect(getChannelConnectionProbe('telegram', 'account', probe.conversationId, false)).toMatchObject({ phase: 'pending' });
    await handleChannelConnectionProbe({ ...inbound, identity: '5' });
    expect(getChannelConnectionClaimant('telegram', 'account', probe.conversationId, '5')).toBe('42');
    expect(getChannelConnectionClaimant('telegram', 'account', probe.conversationId, 'other')).toBeUndefined();
    confirmChannelConnectionProbe('telegram', 'account', probe.conversationId);
    expect(getChannelConnectionProbe('telegram', 'account', probe.conversationId, false)).toMatchObject({ ok: true, phase: 'done' });
    await handleChannelConnectionProbe({ ...inbound, identity: '5' });
    expect(reply).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../api/client';
import { respondVoiceApproval, voiceApprovalsOptions, VoiceRequestError } from '../voice';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../query-client', () => ({ queryClient: {} }));
vi.mock('../sessions', () => ({ fetchSession: vi.fn() }));

const api = vi.mocked(apiFetch);
beforeEach(() => vi.clearAllMocks());

describe('voice confirmation queries', () => {
  it('only exposes pending, unexpired confirmations for the selected session', async () => {
    const item = { id: 'approval', sessionKey: 'chat/a', status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    api.mockResolvedValue(new Response(JSON.stringify({ payload: { approvals: [item,
      { ...item, sessionKey: 'other' }, { ...item, status: 'approved' }, { ...item, expiresAt: '2000-01-01' },
    ] } })));
    const signal = new AbortController().signal;
    await expect(voiceApprovalsOptions('gateway', 'chat/a').queryFn({ signal })).resolves.toEqual([item]);
    expect(api).toHaveBeenCalledWith('/api/connectors/approvals?status=pending&sessionKey=chat%2Fa', { signal });
  });

  it.each([403, 404])('retains HTTP %s and stops automatic polling until an explicit refresh', async status => {
    api.mockResolvedValue(new Response('{}', { status }));
    const options = voiceApprovalsOptions('gateway', 'chat');
    await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({ code: 'APPROVALS_UNAVAILABLE', status });
    expect(options.refetchInterval({ state: { error: new VoiceRequestError('APPROVALS_UNAVAILABLE', status) } })).toBe(false);
    expect(options.refetchInterval({ state: { error: null } })).toBe(3000);
    expect(options.refetchInterval({ state: { error: new VoiceRequestError('APPROVALS_UNAVAILABLE', 503) } })).toBe(3000);
  });

  it('binds confirmation decisions to the displayed conversation', async () => {
    api.mockResolvedValue(new Response('{}'));
    await respondVoiceApproval('approval', 'approved', 'chat/a');
    expect(api).toHaveBeenCalledWith('/api/connectors/approvals/respond', {
      method: 'POST', body: JSON.stringify({ id: 'approval', decision: 'approved', sessionKey: 'chat/a' }),
    });
  });
});

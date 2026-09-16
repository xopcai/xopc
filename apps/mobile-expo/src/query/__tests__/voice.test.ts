import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../api/client';
import { updateVoiceSelection, voiceCatalogOptions, respondVoiceApproval, voiceApprovalsOptions, VoiceRequestError } from '../voice';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../query-client', () => ({ queryClient: {setQueryData: vi.fn(), invalidateQueries: vi.fn()} }));
vi.mock('../sessions', () => ({ fetchSession: vi.fn() }));

const api = vi.mocked(apiFetch);
beforeEach(() => vi.clearAllMocks());

describe('voice confirmation queries', () => {
  it('only exposes pending, unexpired confirmations for the selected session', async () => {
    const item = { id: 'approval', conversationId: 'chat/a', status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    api.mockResolvedValue(new Response(JSON.stringify({ payload: { approvals: [item,
      { ...item, conversationId: 'other' }, { ...item, status: 'approved' }, { ...item, expiresAt: '2000-01-01' },
    ] } })));
    const signal = new AbortController().signal;
    await expect(voiceApprovalsOptions('gateway', 'chat/a').queryFn({ signal })).resolves.toEqual([item]);
    expect(api).toHaveBeenCalledWith('/api/connectors/approvals?status=pending&conversationId=chat%2Fa', { signal });
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
      method: 'POST', body: JSON.stringify({ id: 'approval', decision: 'approved', conversationId: 'chat/a' }),
    });
  });
});


describe('shared voice model settings', () => {
  it.each([[403, 'VOICE_CONFIGURE_FORBIDDEN'], [409, 'SETTINGS_CHANGED'], [503, 'SERVICE_UNAVAILABLE']] as const)('retains actionable settings failure %s', async (status, code) => {
    api.mockResolvedValue(new Response('{}', {status}));
    await expect(updateVoiceSelection('gateway', 'revision', {mode:'conversation',model:'future-model'})).rejects.toMatchObject({status,code});
    expect(api).toHaveBeenCalledWith('/api/voice/selection', {method:'PUT', body:JSON.stringify({revision:'revision',selection:{mode:'conversation',model:'future-model'}})});
  });
  it('shares the returned revision while separating gateway caches', async () => {
    const catalog = {revision:'next',catalogVersion:'2',selections:[],models:[]};
    api.mockResolvedValue(new Response(JSON.stringify({payload:catalog})));
    await expect(updateVoiceSelection('gateway','old')).resolves.toEqual(catalog);
    expect(api).toHaveBeenCalledWith('/api/voice/catalog/refresh',{method:'POST'});
    expect(voiceCatalogOptions('a').queryKey).not.toEqual(voiceCatalogOptions('b').queryKey);
  });
});

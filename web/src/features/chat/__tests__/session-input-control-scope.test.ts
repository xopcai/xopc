// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestInputControl, rememberInputControl, readInputControl } from '../session/session-input-control';
import { useGatewayStore } from '@/stores/gateway-store';
import { apiFetch } from '@/lib/fetch';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('control request scope', () => {
  it.each([false, true])('never retries after the authenticated gateway scope changes (returns to original=%s)', async returnsToOriginal => {
    useGatewayStore.setState({ conversationId: 'original' });
    let reject!: (error: Error) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const request = requestInputControl('conversation', { action: 'stop', operationId: 'stop', expectedTranscriptId: 'transcript', expectedVersion: 0 });
    useGatewayStore.setState({ conversationId: 'another' });
    if (returnsToOriginal) useGatewayStore.setState({ conversationId: 'original' });
    reject(new Error('Connection lost'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(apiFetch).toHaveBeenCalledOnce();
  });
  it('reuses the exact operation identity after an ambiguous connection failure', async () => {
    useGatewayStore.setState({ conversationId: 'original' });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(Response.json({ payload: {} }));
    await requestInputControl('conversation', { action: 'stop', operationId: 'same-operation', expectedTranscriptId: 'transcript', expectedVersion: 0 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(apiFetch).mock.calls;
    expect(requests[0][0]).toBe(requests[1][0]);
    expect(requests[0][1]?.body).toBe(requests[1][1]?.body);
  });
  it('does not let an older view overwrite newer control state in the shared cache', () => {
    useGatewayStore.setState({ conversationId: 'shared-views' });
    const stopped = { paused: true, phase: 'idle' as const, version: 2, reviewRequired: false };
    rememberInputControl('conversation', stopped, 10);
    expect(rememberInputControl('conversation', { ...stopped, phase: 'running' }, 9)).toBe(false);
    expect(readInputControl('conversation').phase).toBe('idle');
  });

});

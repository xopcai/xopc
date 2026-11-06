// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInputCommand } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { submitQueuedInput } from '../session/submit-queued-input';
import { clearPendingSessionCommand, readPendingSessionCommand, savePendingSessionCommand } from '../session/local-session-drafts';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../session/local-session-drafts', () => ({
  clearPendingSessionCommand: vi.fn(), readPendingSessionCommand: vi.fn(), savePendingSessionCommand: vi.fn(),
}));
const command: Extract<SessionInputCommand, { kind: 'append' }> = {
  kind: 'append', clientMessageId: 'original', expectedTranscriptId: 'transcript', configVersion: 1,
  controlVersion: 2, delivery: 'next', input: { content: 'follow-up' },
  origin: { type: 'endpoint', endpointId: 'endpoint', token: 'fresh' },
};
const durable = () => { const { origin: _origin, ...rest } = command; return rest; };
const accepted = (transcriptId = 'transcript') => ({ payload: {
  receipt: { conversationId: 'conversation', clientMessageId: 'original', transcriptId: 'transcript' },
  session: { transcriptId }, inputState: { revision: 10 },
} });
beforeEach(() => { vi.resetAllMocks(); });

describe('durable follow-up submission', () => {
  it.each(['accepted', 'not-received'])('recovers a steer submission after a lost reply (%s)', async state => {
    const steer = { ...command, delivery: 'steer' as const, interrupt: false };
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Connection lost'))
      .mockRejectedValueOnce(new Error('Connection still unavailable'));
    await expect(submitQueuedInput('conversation', steer, () => true)).rejects.toThrow('Connection lost');
    const frozen = vi.mocked(savePendingSessionCommand).mock.calls[0][1];
    vi.mocked(readPendingSessionCommand).mockResolvedValue(frozen);
    if (state === 'not-received') vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ error: { code: 'NOT_RECEIVED' } }, { status: 404 }));
    vi.mocked(apiFetch).mockResolvedValueOnce(Response.json(accepted()));
    expect(await submitQueuedInput('conversation', { ...steer, clientMessageId: 'new' }, () => true)).toEqual({ revision: 10 });
    if (state === 'not-received') expect(JSON.parse(vi.mocked(apiFetch).mock.calls[3][1]!.body as string)).toEqual(steer);
    expect(clearPendingSessionCommand).toHaveBeenCalledWith('conversation', 'original');
  });

  it.each(['next', 'steer'] as const)('rejects changing unresolved %s delivery semantics', async delivery => {
    vi.mocked(readPendingSessionCommand).mockResolvedValue({ ...durable(), delivery });
    await expect(submitQueuedInput('conversation', { ...command, delivery: delivery === 'next' ? 'steer' : 'next' }, () => true))
      .rejects.toThrow('awaiting confirmation');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('persists the command before posting and retains it after a lost reply', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Connection lost'));
    await expect(submitQueuedInput('conversation', command, () => true)).rejects.toThrow('Connection lost');
    expect(savePendingSessionCommand).toHaveBeenCalledWith('conversation', durable());
    expect(clearPendingSessionCommand).not.toHaveBeenCalled();
  });
  it.each([
    ['lost connection', () => Promise.reject(new Error('Connection lost'))],
    ['truncated response', () => Promise.resolve(new Response('{"payload":', { status: 202 }))],
    ['proxy timeout', () => Promise.resolve(Response.json({ error: 'Gateway timeout' }, { status: 504 }))],
  ] as const)('confirms an accepted input in the same submission after a %s', async (_name, submit) => {
    vi.mocked(apiFetch).mockImplementationOnce(submit).mockResolvedValueOnce(Response.json(accepted()));

    await expect(submitQueuedInput('conversation', command, () => true)).resolves.toEqual({ revision: 10 });

    expect(vi.mocked(apiFetch).mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method ?? 'GET'])).toEqual([
      ['/api/sessions/conversation/inputs', 'POST'],
      ['/api/sessions/conversation/input-receipts/original', 'GET'],
    ]);
    expect(clearPendingSessionCommand).toHaveBeenCalledExactlyOnceWith('conversation', 'original');
  });
  it('recovers an accepted receipt after refresh without reposting or changing its identity', async () => {
    vi.mocked(readPendingSessionCommand).mockResolvedValue(durable());
    vi.mocked(apiFetch).mockResolvedValue(Response.json(accepted()));
    expect(await submitQueuedInput('conversation', { ...command, clientMessageId: 'new', controlVersion: 99 }, () => true)).toEqual({ revision: 10 });
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('/input-receipts/original');
    expect(clearPendingSessionCommand).toHaveBeenCalledWith('conversation', 'original');
  });
  it('reposts the frozen command only when the server confirms it was not received', async () => {
    vi.mocked(readPendingSessionCommand).mockResolvedValue(durable());
    vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ error: { code: 'NOT_RECEIVED' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(accepted(), { status: 202 }));
    await submitQueuedInput('conversation', { ...command, clientMessageId: 'new', controlVersion: 99 }, () => true);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string)).toEqual(command);
  });
  it('does not overwrite an unresolved command with different content', async () => {
    vi.mocked(readPendingSessionCommand).mockResolvedValue(durable());
    await expect(submitQueuedInput('conversation', { ...command, input: { content: 'different' } }, () => true)).rejects.toThrow('awaiting confirmation');
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('does not confirm a receipt from before a conversation reset', async () => {
    vi.mocked(readPendingSessionCommand).mockResolvedValue(durable());
    vi.mocked(apiFetch).mockResolvedValue(Response.json(accepted('new-transcript')));
    await expect(submitQueuedInput('conversation', command, () => true)).rejects.toThrow('conversation was reset');
    expect(clearPendingSessionCommand).not.toHaveBeenCalled();
  });
  it('does not post after leaving the view during durable storage', async () => {
    let current = true;
    vi.mocked(savePendingSessionCommand).mockImplementation(async () => { current = false; });
    await expect(submitQueuedInput('conversation', command, () => current)).rejects.toMatchObject({ name: 'AbortError' });
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('releases only its own rejected command and preserves the draft for explicit retry', async () => {
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ error: { message: 'Queue changed' } }, { status: 409 }));
    await expect(submitQueuedInput('conversation', command, () => true)).rejects.toThrow('Queue changed');
    expect(clearPendingSessionCommand).toHaveBeenCalledWith('conversation', 'original');
  });
});

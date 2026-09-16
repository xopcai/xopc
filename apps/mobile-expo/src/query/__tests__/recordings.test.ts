import type { LocalRecording } from '../../features/recordings/recordings';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ items: [] as LocalRecording[], profile: { gatewayId: 'g', deviceId: 'd', gatewayPublicKey: 'pk' }, chunks: vi.fn(), fetch: vi.fn(), upload: vi.fn() }));
vi.mock('../../features/recordings/recordings', () => ({ recordingChunks: state.chunks, saveRecording: (item: LocalRecording) => { state.items = [item]; }, useRecordings: { getState: () => ({ items: state.items }) } }));
vi.mock('../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ getActiveProfile: () => state.profile }) } }));
vi.mock('../../api/client', () => ({ apiFetch: state.fetch, apiUploadFile: state.upload }));
import { uploadRecording } from '../recordings';
const detail = { discussion: { id: 'discussion', noteId: 'note', status: 'recording' } };
beforeEach(() => {
  vi.clearAllMocks(); state.profile.gatewayId = 'g';
  state.items = [{ id: 'local', recordedAt: 100, state: 'saved', binding: { gatewayId: 'g', deviceId: 'd', publicKey: 'pk' } }];
  state.chunks.mockResolvedValue([{ sequence: 0, sha256: 'a', bytes: 32044, uri: 'file:///0.wav' }, { sequence: 1, sha256: 'b', bytes: 32044, uri: 'file:///1.wav' }]);
  state.upload.mockResolvedValue({ ok: true });
  state.fetch.mockImplementation(async (path: string, init?: RequestInit) => ({ ok: true, json: async () => path.endsWith('settings') ? { consentPolicyVersion: 1 }
    : path.endsWith('/chunks') ? [{ sequence: 0, sha256: 'a', bytes: 32044 }]
      : init?.method === 'POST' && path.endsWith('/seal') ? {} : detail }));
});
it('resumes confirmed chunks and seals an independent WAV manifest', async () => {
  await uploadRecording(state.items[0], vi.fn());
  expect(state.upload).toHaveBeenCalledTimes(1);
  expect(state.upload).toHaveBeenCalledWith('/api/discussions/discussion/recording/chunks/1', expect.objectContaining({ method: 'PUT', binary: true, uri: 'file:///1.wav' }));
  const seal = state.fetch.mock.calls.find(([path]) => path.endsWith('/seal'))!;
  expect(JSON.parse(seal[1].body)).toMatchObject({ containerMode: 'independent_wav', chunkCount: 2, lastSequence: -1 });
  expect(state.items[0].noteId).toBe('note');
});
it('stops before uploading when the workspace changes during preparation', async () => {
  state.chunks.mockImplementation(async () => { state.profile.gatewayId = 'other'; return [{ sequence: 0 }]; });
  await expect(uploadRecording(state.items[0], vi.fn())).rejects.toThrow('RECORDING_WORKSPACE_CHANGED');
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
});
it('does not resend a chunk with a conflicting server receipt', async () => {
  state.chunks.mockResolvedValue([{ sequence: 0, sha256: 'changed', bytes: 32044 }]);
  await expect(uploadRecording(state.items[0], vi.fn())).rejects.toThrow('RECORDING_CHUNK_CONFLICT');
  expect(state.upload).not.toHaveBeenCalled();
});

it('loads recording text by note ID independently of editable markdown', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const { recordingNoteOptions } = await import('../recordings');
  const client = new QueryClient();
  const result = { ...detail, transcript: { text: 'Confirmed recording text' }, note: { markdown: 'My notes' } };
  state.fetch.mockResolvedValue(new Response(JSON.stringify(result)));
  try {
    await expect(client.fetchQuery(recordingNoteOptions('note/1', state.items[0].binding))).resolves.toEqual(result);
    expect(state.fetch).toHaveBeenCalledWith('/api/discussions/by-note/note%2F1');
  } finally { client.clear(); }
});

it('treats an ordinary note with no recording as absent, but surfaces server failures', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const { recordingNoteOptions } = await import('../recordings');
  const client = new QueryClient();
  try {
    state.fetch.mockResolvedValue(new Response('', { status: 404 }));
    await expect(client.fetchQuery(recordingNoteOptions('ordinary', state.items[0].binding))).resolves.toBeNull();
    state.fetch.mockResolvedValue(new Response('', { status: 500 }));
    await expect(client.fetchQuery(recordingNoteOptions('failed', state.items[0].binding))).rejects.toThrow('HTTP 500');
  } finally { client.clear(); }
});

it('rejects note results if the workspace changes while the response is in flight', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const { recordingNoteOptions } = await import('../recordings');
  const client = new QueryClient();
  state.fetch.mockImplementation(async () => {
    state.profile.gatewayId = 'other';
    return new Response(JSON.stringify(detail));
  });
  try {
    await expect(client.fetchQuery(recordingNoteOptions('note', state.items[0].binding))).rejects.toThrow('RECORDING_WORKSPACE_CHANGED');
  } finally { client.clear(); }
});

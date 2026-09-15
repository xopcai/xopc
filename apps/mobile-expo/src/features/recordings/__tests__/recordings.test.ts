import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(), active: null as string | null,
  start: vi.fn(), stop: vi.fn(), chunks: vi.fn(), release: vi.fn(), claim: vi.fn(() => true), permission: vi.fn(async () => ({ granted: true })),
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({ startRecording: mocks.start, stopRecording: mocks.stop, activeRecording: async () => mocks.active, recordingChunks: mocks.chunks }) }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
vi.mock('../../../storage/mmkv', () => ({ storage: { getString: (key: string) => mocks.storage.get(key), set: (key: string, value: string) => mocks.storage.set(key, value) } }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({ getActiveProfile: () => null }) } }));
vi.mock('../../voice/audio-playback-coordinator', () => ({ claimAudioCapture: mocks.claim, releaseAudioCapture: mocks.release }));
vi.mock('../../chat/voiceRecording', () => ({ requestMicPermission: mocks.permission }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.storage.clear(); mocks.active = null; mocks.permission.mockResolvedValue({ granted: true }); });
it('does not release an existing recording when a second start is rejected', async () => {
  const api = await import('../recordings');
  mocks.active = 'existing';
  await expect(api.startRecording({ title: 'Meeting', stop: 'Stop' })).rejects.toThrow('RECORDING_BUSY');
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
it('does not replace a corrupt local index', async () => {
  mocks.storage.set('recordings.captures.v1', 'broken');
  const api = await import('../recordings');
  await expect(api.startRecording({ title: 'Meeting', stop: 'Stop' })).rejects.toThrow();
  expect(mocks.storage.get('recordings.captures.v1')).toBe('broken');
});
it('recovers interrupted metadata and derives duration from persisted samples', async () => {
  const api = await import('../recordings');
  const item = { id: 'capture', recordedAt: 100, state: 'recording' as const };
  api.saveRecording(item);
  await api.reconcileRecording();
  expect(api.useRecordings.getState().items[0]?.state).toBe('interrupted');
  mocks.chunks.mockResolvedValue([{ sampleCount: 16000 }, { sampleCount: 8000 }]);
  await api.finishRecording(item);
  expect(api.useRecordings.getState().items[0]).toMatchObject({ state: 'saved', durationMs: 1500 });
});
it('does not create a phantom recording after permission denial', async () => {
  const api = await import('../recordings');
  mocks.permission.mockResolvedValue({ granted: false });
  await expect(api.startRecording({ title: 'Meeting', stop: 'Stop' })).rejects.toThrow('PERMISSION_DENIED');
  expect(api.useRecordings.getState().items).toEqual([]);
});

it('keeps microphone ownership while finishing a different interrupted capture', async () => {
  const api = await import('../recordings');
  mocks.active = 'current';
  mocks.chunks.mockResolvedValue([{ sampleCount: 16000 }]);
  await api.finishRecording({ id: 'previous', recordedAt: 100, state: 'interrupted' });
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.release).not.toHaveBeenCalled();
});

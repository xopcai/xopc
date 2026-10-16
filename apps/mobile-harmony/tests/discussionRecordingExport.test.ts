import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ write: vi.fn(), close: vi.fn(), save: vi.fn(), parts: [] as Uint8Array[] }));
vi.mock('../entry/src/main/ets/service/discussionAnnotations.ets', () => ({ XopcAnnotationStore: class { initialize = async () => {}; list = async () => []; } }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkTS', () => ({ util: { TextEncoder: class { encodeInto(text: string) { return new TextEncoder().encode(text); } } } }));
vi.mock('@kit.CoreFileKit', () => ({
  fileIo: { OpenMode: { WRITE_ONLY: 1, TRUNC: 2 }, open: async () => ({ fd: 1 }), write: mocks.write, close: mocks.close },
  picker: { DocumentSaveOptions: class {}, DocumentViewPicker: class { save = mocks.save; } },
}));
import { xopcExportRecording } from '../entry/src/main/ets/service/discussionRecordingExport.ets';
const session = { id: 'source', gatewayId: 'gateway', consentVersion: 1, recordedAt: 1, discussionId: 'discussion', noteId: 'note', markers: [3000] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.parts = []; mocks.save.mockResolvedValue(['file:///export.tar']);
  mocks.write.mockImplementation(async (_fd, data: ArrayBuffer) => { mocks.parts.push(new Uint8Array(data).slice()); return data.byteLength; });
});
function store() {
  return { chunks: vi.fn(async () => [{ sequence: 0, startedAtMs: 0, endedAtMs: 3000 }]),
    events: vi.fn(async () => [{ kind: 'resume', recordedAt: 10000, savedMs: 3000 }]),
    audio: vi.fn(async () => new Uint8Array([82, 73, 70, 70])), remove: vi.fn() };
}
it('exports independent originals and persistent markers/interruption history without removing source audio', async () => {
  const source = store(); await xopcExportRecording({} as never, source as never, session);
  const bytes = Buffer.concat(mocks.parts);
  expect(bytes.toString()).toContain('manifest.json'); expect(bytes.toString()).toContain('audio/000000.wav');
  expect(bytes.toString()).toContain('"markers":[3000]'); expect(bytes.toString()).toContain('"kind":"resume"');
  expect(source.chunks).toHaveBeenCalledWith('source', false); expect(source.remove).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it('closes partial exports on storage failure and retains the only local source', async () => {
  const source = store(); mocks.write.mockResolvedValueOnce(1);
  await expect(xopcExportRecording({} as never, source as never, session)).rejects.toThrow('INCOMPLETE_FILE_WRITE');
  expect(source.remove).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledOnce();
});
it('cancelled picker leaves source audio untouched', async () => {
  const source = store(); mocks.save.mockResolvedValue([]);
  await xopcExportRecording({} as never, source as never, session);
  expect(source.audio).not.toHaveBeenCalled(); expect(source.remove).not.toHaveBeenCalled();
});

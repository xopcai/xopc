import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkTS', () => ({ util: { Base64Helper: class {
  decodeSync(value: string): Uint8Array { return new Uint8Array(Buffer.from(value, 'base64')); }
} } }));
vi.mock('@kit.NetworkKit', () => ({ http: {
  createHttp: () => ({ request: mocks.request, destroy: mocks.destroy }),
  RequestMethod: { POST: 'POST' }, HttpDataType: { STRING: 'string' },
} }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: {} }));
vi.mock('../entry/src/main/ets/service/chatAttachmentPicker.ets', () => ({ pickChatAttachment: vi.fn() }));
vi.mock('../entry/src/main/ets/service/chatPhotoPicker.ets', () => ({ pickChatPhoto: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  transferAuth: async () => ({ origin: 'https://gateway.example', token: 'token' }),
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));

import { XopcNoteMediaService } from '../entry/src/main/ets/service/noteMedia.ets';

describe('Harmony note media upload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.request.mockResolvedValue({ responseCode: 201, result: JSON.stringify({ attachment: {
      id: 'attachment-1', type: 'audio', mimeType: 'audio/mp4', fileName: 'voice.m4a', size: 3,
      relativePath: 'media/voice.m4a', duration: 2,
    } }) });
  });

  it('uploads voice duration with the binary payload', async () => {
    await new XopcNoteMediaService().upload('note/1', {
      type: 'voice', name: 'voice.m4a', mimeType: 'audio/mp4', size: 3,
      data: Buffer.from([1, 2, 3]).toString('base64'), duration: 2,
    }, 'mutation-1');
    expect(mocks.request).toHaveBeenCalledWith('https://gateway.example/api/notes/note%2F1/media', expect.objectContaining({
      method: 'POST',
      multiFormDataList: [
        expect.objectContaining({ name: 'file', contentType: 'audio/mp4', remoteFileName: 'voice.m4a' }),
        { name: 'duration', contentType: 'text/plain', data: '2' },
      ],
    }));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

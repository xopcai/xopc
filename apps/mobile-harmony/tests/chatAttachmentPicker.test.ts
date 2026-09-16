import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ select: vi.fn(), open: vi.fn(), stat: vi.fn(), read: vi.fn(), close: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.CoreFileKit', () => ({
  picker: { DocumentSelectOptions: class {}, DocumentViewPicker: class { select = mocks.select; } },
  fileUri: { FileUri: class { name = 'sample.png'; } },
  fileIo: { OpenMode: { READ_ONLY: 0 }, open: mocks.open, stat: mocks.stat, read: mocks.read, close: mocks.close },
}));
vi.mock('@kit.ArkTS', () => ({ util: { Base64Helper: class { async encodeToString(data: Uint8Array) { return Buffer.from(data).toString('base64'); } } } }));
import { pickChatAttachment } from '../entry/src/main/ets/service/chatAttachmentPicker.ets';
describe('native attachment picker', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.select.mockResolvedValue(['file://selected']); mocks.open.mockResolvedValue({ fd: 1 });
    mocks.stat.mockResolvedValue({ size: 3 }); mocks.read.mockImplementation(async (_fd, data) => { new Uint8Array(data).set([1, 2, 3]); return 3; });
  });
  it('reads only the selected URI, closes it, and emits standard base64 without local paths', async () => {
    expect(await pickChatAttachment({} as never, [])).toEqual({ name: 'sample.png', mimeType: 'image/png', type: 'image', size: 3, data: 'AQID' });
    expect(mocks.open).toHaveBeenCalledWith('file://selected', 0); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('does nothing when the system picker is cancelled', async () => {
    mocks.select.mockResolvedValue([]); expect(await pickChatAttachment({} as never, [])).toBeUndefined();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('closes an oversized file before reading or encoding it', async () => {
    mocks.stat.mockResolvedValue({ size: 11 * 1024 * 1024 });
    await expect(pickChatAttachment({} as never, [])).rejects.toThrow('ATTACHMENT_LIMIT_10_MB');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('rejects truncated reads and still closes the file', async () => {
    mocks.read.mockResolvedValue(2); await expect(pickChatAttachment({} as never, [])).rejects.toThrow('INCOMPLETE_FILE_READ');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

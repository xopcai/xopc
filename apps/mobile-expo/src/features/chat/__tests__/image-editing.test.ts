import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  manipulate: vi.fn(),
  rotate: vi.fn(),
  crop: vi.fn(),
  renderAsync: vi.fn(),
  saveAsync: vi.fn(),
}));

vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: mocks.manipulate },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { cropImageAttachment, rotateImageForEditing } from '../image-editing';

describe('image editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manipulate.mockReturnValue({ rotate: mocks.rotate, crop: mocks.crop, renderAsync: mocks.renderAsync });
    mocks.renderAsync.mockResolvedValue({ saveAsync: mocks.saveAsync });
  });

  it('rotates a local preview with the modern contextual API', async () => {
    mocks.saveAsync.mockResolvedValue({ uri: 'file:///rotated.jpg', width: 200, height: 400 });

    await rotateImageForEditing('file:///photo.jpg', 'image/jpeg', 270);

    expect(mocks.rotate).toHaveBeenCalledWith(270);
    expect(mocks.saveAsync).toHaveBeenCalledWith({ base64: false, compress: 0.92, format: 'jpeg' });
  });

  it('crops and replaces the attachment payload without stale remote fields', async () => {
    mocks.saveAsync.mockResolvedValue({
      uri: 'file:///edited.png',
      width: 100,
      height: 100,
      base64: 'YWJj',
    });
    const attachment = {
      id: 'image-1',
      type: 'image' as const,
      name: 'photo.png',
      mimeType: 'image/png',
      size: 50,
      content: 'old',
      localUri: 'file:///photo.png',
      uri: 'media://old',
      workspaceRelativePath: 'old/photo.png',
    };

    const result = await cropImageAttachment(
      attachment,
      'file:///photo.png',
      { originX: 10, originY: 20, width: 100, height: 100 },
      90,
    );

    expect(mocks.rotate).toHaveBeenCalledWith(90);
    expect(mocks.crop).toHaveBeenCalledWith({ originX: 10, originY: 20, width: 100, height: 100 });
    expect(result).toEqual({
      id: 'image-1',
      type: 'image',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 3,
      content: 'YWJj',
      localUri: 'file:///edited.png',
    });
  });
});

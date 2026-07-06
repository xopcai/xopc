import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCameraPermissionsAsync = vi.fn();
const requestCameraPermissionsAsync = vi.fn();
const getMediaLibraryPermissionsAsync = vi.fn();
const requestMediaLibraryPermissionsAsync = vi.fn();
const launchCameraAsync = vi.fn();
const launchImageLibraryAsync = vi.fn();
const getDocumentAsync = vi.fn();

vi.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
}));

vi.mock('expo-document-picker', () => ({
  getDocumentAsync,
}));

describe('pickAttachmentFromSource permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCameraPermissionsAsync.mockResolvedValue({ granted: true });
    requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        base64: 'YWJj',
        fileSize: 3,
      }],
    });
    launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: 'file:///image.jpg',
        fileName: 'image.jpg',
        mimeType: 'image/jpeg',
        base64: 'YWJj',
        fileSize: 3,
      }],
    });
  });

  it('does not request photo library permission before opening the system picker', async () => {
    const { pickAttachmentFromSource } = await import('../attachment-file-io');

    const attachment = await pickAttachmentFromSource('photos');

    expect(attachment?.name).toBe('image.jpg');
    expect(getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(launchImageLibraryAsync).toHaveBeenCalledOnce();
  });

  it('still requires camera permission before taking a photo', async () => {
    getCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: true });
    const { pickAttachmentFromSource } = await import('../attachment-file-io');

    await pickAttachmentFromSource('camera');

    expect(getCameraPermissionsAsync).toHaveBeenCalledOnce();
    expect(requestCameraPermissionsAsync).toHaveBeenCalledOnce();
    expect(launchCameraAsync).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileState = vi.hoisted(() => ({
  entries: new Map<string, { exists: boolean; size: number; base64: string }>(),
}));

vi.mock('expo-file-system', () => ({
  File: class File {
    constructor(readonly uri: string) {}

    get exists(): boolean {
      return fileState.entries.get(this.uri)?.exists ?? false;
    }

    get size(): number {
      return fileState.entries.get(this.uri)?.size ?? 0;
    }

    async base64(): Promise<string> {
      return fileState.entries.get(this.uri)?.base64 ?? '';
    }
  },
}));

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(),
}));

vi.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

import { getDocumentAsync } from 'expo-document-picker';

import { pickAttachmentFromSource, readUriAsBase64 } from '../attachment-file-io';

describe('readUriAsBase64 native files', () => {
  beforeEach(() => {
    fileState.entries.clear();
    vi.unstubAllGlobals();
  });

  it('reads Android recorder file URIs through Expo FileSystem', async () => {
    const uri = 'file:///data/user/0/ai.xopc.xopc/cache/Audio/recording.m4a';
    fileState.entries.set(uri, { exists: true, size: 3, base64: 'YWJj' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(readUriAsBase64(uri, 'voice.m4a')).resolves.toEqual({
      content: 'YWJj',
      size: 3,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports inaccessible Android content URIs as read failures', async () => {
    const uri = 'content://ai.xopc.xopc/recording.m4a';
    fileState.entries.set(uri, { exists: false, size: 0, base64: '' });

    await expect(readUriAsBase64(uri, 'voice.m4a')).rejects.toMatchObject({
      name: 'AttachmentFileError',
      code: 'read_failed',
      fileName: 'voice.m4a',
    });
  });
});

describe('local document attachments', () => {
  beforeEach(() => {
    fileState.entries.clear();
    vi.clearAllMocks();
  });

  it('loads a selected document from the picker cache into the composer', async () => {
    const uri = 'file:///cache/report.pdf';
    fileState.entries.set(uri, { exists: true, size: 3, base64: 'YWJj' });
    vi.mocked(getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri, name: 'report.pdf', mimeType: 'application/pdf', size: 3, lastModified: 0 }],
    });

    await expect(pickAttachmentFromSource('document')).resolves.toMatchObject({
      type: 'document', name: 'report.pdf', mimeType: 'application/pdf', content: 'YWJj', size: 3,
    });
    expect(getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({
      copyToCacheDirectory: true,
    }));
  });

  it('leaves the draft unchanged when document selection is cancelled', async () => {
    vi.mocked(getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAttachmentFromSource('document')).resolves.toBeNull();
  });
});

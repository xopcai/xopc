import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { captureNote, uploadNoteMedia } from '../notes';

const platform = vi.hoisted(() => ({ OS: 'web' }));

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number, statusText: string, message?: string) =>
    message ? `${status} ${statusText}: ${message}` : `${status} ${statusText}`,
  ),
}));

const mockedApiFetch = vi.mocked(apiFetch);

describe('uploadNoteMedia', () => {
  beforeEach(() => {
    platform.OS = 'web';
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        attachment: {
          id: 'att-1',
          type: 'image',
          mimeType: 'image/png',
          fileName: 'photo.png',
          size: 4,
          relativePath: 'notes/note-1/att-1.png',
        },
      }),
    } as Response);
  });

  it('uploads the ImagePicker web File instead of treating localUri as missing content', async () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' });

    await expect(uploadNoteMedia('note-1', {
      localUri: 'blob:http://localhost/photo',
      file,
      name: 'photo.png',
      mimeType: 'image/png',
    })).resolves.toEqual(expect.objectContaining({ id: 'att-1' }));

    const [path, init] = mockedApiFetch.mock.calls[0];
    expect(path).toBe('/api/notes/note-1/media');
    expect(init?.body).toBeInstanceOf(FormData);
    const appended = (init?.body as FormData).get('file') as File;
    expect(appended.name).toBe('photo.png');
    expect(appended.type).toBe('image/png');
    expect(appended.size).toBe(4);
  });

  it('falls back to base64 content when native localUri upload fails', async () => {
    platform.OS = 'ios';
    mockedApiFetch
      .mockRejectedValueOnce(new Error('local file unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          attachment: {
            id: 'att-1',
            type: 'image',
            mimeType: 'image/png',
            fileName: 'photo.png',
            size: 4,
            relativePath: 'notes/note-1/att-1.png',
          },
        }),
      } as Response);

    await expect(uploadNoteMedia('note-1', {
      localUri: 'file:///tmp/missing-photo.png',
      name: 'photo.png',
      mimeType: 'image/png',
      content: btoa('data'),
    })).resolves.toEqual(expect.objectContaining({ id: 'att-1' }));

    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    const fallbackFile = (mockedApiFetch.mock.calls[1][1]?.body as FormData).get('file') as File;
    expect(fallbackFile.name).toBe('photo.png');
    expect(await fallbackFile.text()).toBe('data');
  });
});

describe('captureNote attachments', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ note: { id: 'note-1' } }),
    } as Response);
  });

  it('creates a note with the first attachment in the multipart request', async () => {
    await expect(captureNote({
      text: 'receipt',
      kind: 'media',
      attachments: [{
        fileName: 'receipt.png',
        mimeType: 'image/png',
        data: btoa('png-data'),
      }],
    })).resolves.toEqual({ note: { id: 'note-1' } });

    const [path, init] = mockedApiFetch.mock.calls[0];
    expect(path).toBe('/api/notes');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);

    const form = init?.body as FormData;
    expect(form.get('markdown')).toBe('receipt');
    expect(form.get('kind')).toBe('media');
    expect(form.get('channel')).toBe('app');

    const file = form.get('file') as File;
    expect(file.name).toBe('receipt.png');
    expect(file.type).toBe('image/png');
    expect(await file.text()).toBe('png-data');
  });
});

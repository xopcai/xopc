import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { captureNote, quickCaptureNote, uploadNoteMedia } from '../notes';

const platform = vi.hoisted(() => ({ OS: 'ios' }));

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
    platform.OS = 'ios';
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

  it('does not retry a failed native upload through base64', async () => {
    platform.OS = 'ios';
    mockedApiFetch.mockRejectedValueOnce(new Error('local file unavailable'));

    await expect(uploadNoteMedia('note-1', {
      localUri: 'file:///tmp/missing-photo.png',
      name: 'photo.png',
      mimeType: 'image/png',
      content: btoa('data'),
    })).rejects.toThrow('local file unavailable');

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
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

  it('links a multipart note to its project', async () => {
    await captureNote({
      projectId: 'project-1',
      text: 'reference',
      attachments: [{ fileName: 'brief.txt', mimeType: 'text/plain', data: btoa('brief') }],
    });

    const form = mockedApiFetch.mock.calls[0][1]?.body as FormData;
    expect(form.get('projectId')).toBe('project-1');
  });

  it('uses the native audio URI and enables safe route recovery for idempotent capture', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await captureNote({
      kind: 'voice',
      idempotencyKey: 'voice-operation-1',
      attachments: [{
        fileName: 'voice.m4a',
        mimeType: 'audio/mp4',
        localUri: 'file:///documents/voice.m4a',
        data: btoa('audio-data'),
        duration: 2,
      }],
    });

    const [, init] = mockedApiFetch.mock.calls[0];
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'voice-operation-1' },
      recoverRouteOnNetworkError: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('captureNote project', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ note: { id: 'note-1' } })));
  });

  it('uses the full create endpoint so a text note can retain its project link', async () => {
    await captureNote({ projectId: 'project-1', text: 'Project decision' });

    expect(mockedApiFetch).toHaveBeenCalledWith('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        markdown: 'Project decision',
        projectId: 'project-1',
        channel: 'app',
        platform: 'ios',
      }),
    });
  });
});

describe('quickCaptureNote', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ note: { id: 'capture-1' } }),
    } as Response);
  });

  it('forwards source and idempotency metadata', async () => {
    await quickCaptureNote('shared text', {
      channel: 'share',
      idempotencyKey: 'operation-1',
    });

    expect(mockedApiFetch).toHaveBeenCalledWith('/api/notes/quick-capture', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'operation-1' },
      body: JSON.stringify({ text: 'shared text', channel: 'share', platform: 'ios' }),
    });
  });
});

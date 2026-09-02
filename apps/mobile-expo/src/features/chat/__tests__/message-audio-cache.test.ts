import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  directories: [] as Array<{ parts: unknown[]; exists: boolean; deleted: boolean }>,
  files: [] as Array<{ parts: unknown[]; bytes?: Uint8Array }>,
}));

vi.mock('../../../api/client', () => ({
  apiFetch: mocks.apiFetch,
  formatApiHttpError: (status: number, statusText: string, message?: string) =>
    message || `${status} ${statusText}`,
}));

vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache-root' },
  Directory: class Directory {
    exists = false;
    deleted = false;
    readonly parts: unknown[];

    constructor(...parts: unknown[]) {
      this.parts = parts;
      mocks.directories.push(this);
    }

    create() { this.exists = true; }
    delete() { this.deleted = true; this.exists = false; }
  },
  File: class File {
    readonly parts: unknown[];
    readonly uri: string;
    bytes?: Uint8Array;

    constructor(...parts: unknown[]) {
      this.parts = parts;
      this.uri = `file:///cache/${String(parts.at(-1))}`;
      mocks.files.push(this);
    }

    create() {}
    write(bytes: Uint8Array) { this.bytes = bytes; }
  },
}));

import { MessageAudioCache } from '../message-audio-cache';

describe('MessageAudioCache', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.directories.length = 0;
    mocks.files.length = 0;
  });

  it('downloads authenticated gateway audio into a local file', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mpeg; charset=binary' },
    }));
    const cache = new MessageAudioCache('message-1');

    await expect(cache.download('/api/media/read?uri=tts')).resolves.toBe('file:///cache/audio.mp3');

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/media/read?uri=tts', { timeoutMs: 60_000 });
    expect(mocks.files[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reuses the downloaded file and removes its directory', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { 'Content-Type': 'audio/wav' },
    }));
    const cache = new MessageAudioCache('message-2');

    await expect(cache.download('/api/media/read?uri=tts')).resolves.toBe('file:///cache/audio.wav');
    await expect(cache.download('/api/media/read?uri=tts')).resolves.toBe('file:///cache/audio.wav');
    cache.remove();

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.directories[0]?.deleted).toBe(true);
  });

  it('rejects gateway errors and empty audio', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'expired' } }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    }));
    const cache = new MessageAudioCache('message-3');
    await expect(cache.download('/api/media/read?uri=tts')).rejects.toThrow('expired');

    mocks.apiFetch.mockResolvedValueOnce(new Response(new Uint8Array()));
    await expect(cache.download('/api/media/read?uri=tts')).rejects.toThrow('Audio download was empty');
  });
});

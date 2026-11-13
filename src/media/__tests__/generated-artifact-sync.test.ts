import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readMusicArtifact, saveMusicArtifact } from '../../music-generation/artifact.js';
import { murekaProvider } from '../../music-generation/mureka.js';
import { readVideoArtifact, storeVideoArtifact } from '../../video-generation/artifact.js';

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const file = await fs.open(...args);
    if (String(args[0]).endsWith('.part') && args[1] === 'r') {
      vi.spyOn(file, 'sync').mockRejectedValue(new Error('Windows requires write access to flush file buffers'));
    }
    return file;
  } };
});
vi.mock('../../media-shared/http/ssrf-guard.js', () => ({ assertSafeUrl: vi.fn() }));

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xopc-generated-artifact-'));
  vi.stubEnv('XOPC_STATE_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it('flushes and publishes generated MP4 with Windows file permissions', async () => {
  const video = Buffer.from('000000186674797069736f6d', 'hex');
  await storeVideoArtifact('video', new Response(video));
  expect(Buffer.from(await (await readVideoArtifact('video')).arrayBuffer())).toEqual(video);
});

it('flushes and publishes generated MP3 with Windows file permissions', async () => {
  const audio = Buffer.from('fffb9064' + '00'.repeat(414), 'hex');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(audio)));
  await saveMusicArtifact('music', murekaProvider, 'https://cdn.mureka.cn/result.mp3', () => true);
  expect(Buffer.from(await (await readMusicArtifact('music')).arrayBuffer())).toEqual(audio);
});

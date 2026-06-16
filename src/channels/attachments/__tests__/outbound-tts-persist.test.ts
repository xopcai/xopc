import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { persistOutboundTtsAudio } from '../outbound-tts-persist.js';
import { readMediaBuffer } from '../../../media/store.js';

describe('persistOutboundTtsAudio', () => {
  let prevStateDir: string | undefined;

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
  });

  it('writes TTS audio under media/tts and returns MediaRef', async () => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    const work = join(tmpdir(), `xopc-tts-${Date.now()}`);
    process.env.XOPC_STATE_DIR = work;
    await mkdir(work, { recursive: true });

    const ref = await persistOutboundTtsAudio(Buffer.from('audio'), 'mp3');
    expect(ref.uri).toMatch(/^media:\/\/tts\//);
    expect(ref.bucket).toBe('tts');
    expect(ref.type).toBe('voice');

    const read = await readMediaBuffer(ref.id, 'tts');
    expect(read.buffer.toString()).toBe('audio');
    await rm(work, { recursive: true, force: true });
  });
});

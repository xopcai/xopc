import { describe, it, expect } from 'vitest';
import { resolveSafeTtsFilePath, TTS_REL_ROOT } from '../outbound-tts-persist.js';

describe('outbound-tts-persist', () => {
  const ws = '/home/user/ws';

  it('resolveSafeTtsFilePath rejects traversal and non-tts paths', () => {
    expect(resolveSafeTtsFilePath(ws, `${TTS_REL_ROOT}/s/a.mp3`)).toBeTruthy();
    expect(resolveSafeTtsFilePath(ws, `../${TTS_REL_ROOT}/s/a.mp3`)).toBeNull();
    expect(resolveSafeTtsFilePath(ws, 'other/file.txt')).toBeNull();
    expect(resolveSafeTtsFilePath(ws, '.xopcbot/inbound/s/a.bin')).toBeNull();
  });
});

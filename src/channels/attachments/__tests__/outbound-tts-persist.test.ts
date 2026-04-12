import { describe, it, expect } from 'vitest';
import { resolveSafeTtsFilePath, TTS_REL_ROOT } from '../outbound-tts-persist.js';

describe('outbound-tts-persist', () => {
  const agentHome = '/home/user/.xopc/agents/main';
  const roots = { agentHome };

  it('resolveSafeTtsFilePath rejects traversal and non-tts paths', () => {
    expect(resolveSafeTtsFilePath(roots, `${TTS_REL_ROOT}/s/a.mp3`)).toBeTruthy();
    expect(resolveSafeTtsFilePath(roots, `../${TTS_REL_ROOT}/s/a.mp3`)).toBeNull();
    expect(resolveSafeTtsFilePath(roots, 'other/file.txt')).toBeNull();
    expect(resolveSafeTtsFilePath(roots, '.xopc/tts/s/a.mp3')).toBeNull();
  });
});

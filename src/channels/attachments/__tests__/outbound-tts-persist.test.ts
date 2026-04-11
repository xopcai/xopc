import { describe, it, expect } from 'vitest';
import { resolveSafeTtsFilePath, TTS_REL_ROOT } from '../outbound-tts-persist.js';

describe('outbound-tts-persist', () => {
  const legacyWs = '/home/user/ws';
  const agentHome = '/home/user/.xopcbot/agents/main';
  const roots = { agentHome, legacyWorkspace: legacyWs };

  it('resolveSafeTtsFilePath rejects traversal and non-tts paths', () => {
    expect(resolveSafeTtsFilePath(roots, `${TTS_REL_ROOT}/s/a.mp3`)).toBeTruthy();
    expect(resolveSafeTtsFilePath(roots, '.xopcbot/tts/s/a.mp3')).toBeTruthy();
    expect(resolveSafeTtsFilePath(roots, `../${TTS_REL_ROOT}/s/a.mp3`)).toBeNull();
    expect(resolveSafeTtsFilePath(roots, 'other/file.txt')).toBeNull();
    expect(resolveSafeTtsFilePath(roots, '.xopcbot/inbound/s/a.bin')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { xopcAudioLevel, xopcFormatCaptureTime, xopcPcm16Wav,
  xopcPcmDurationMs } from '../entry/src/main/ets/common/discussionAudio.ets';

describe('HarmonyOS discussion capture audio', () => {
  it('wraps 16 kHz mono PCM in a valid little-endian WAV container', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const wav = xopcPcm16Wav([pcm.slice(0, 2), pcm.slice(2)]);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(Array.from(wav.slice(44))).toEqual(Array.from(pcm));
  });

  it('derives captured time from audio bytes so pauses do not inflate duration', () => {
    expect(xopcPcmDurationMs(32000)).toBe(1000);
    expect(xopcFormatCaptureTime(65000)).toBe('01:05');
  });

  it('provides a bounded visual level', () => {
    expect(xopcAudioLevel(new Uint8Array())).toBe(0);
    const loud = new Uint8Array(160);
    const view = new DataView(loud.buffer);
    for (let index = 0; index < 80; index++) view.setInt16(index * 2, 32767, true);
    expect(xopcAudioLevel(loud)).toBe(1);
  });
});

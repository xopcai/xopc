/** Converts 16 kHz mono signed 16-bit PCM into a standalone WAV file. */
export function xopcPcm16Wav(parts: Uint8Array[]): Uint8Array {
  let pcmSize = 0;
  parts.forEach((part: Uint8Array): void => { pcmSize += part.byteLength; });
  const wav = new Uint8Array(44 + pcmSize);
  const view = new DataView(wav.buffer);
  xopcAscii(wav, 0, 'RIFF');
  view.setUint32(4, 36 + pcmSize, true);
  xopcAscii(wav, 8, 'WAVE');
  xopcAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  xopcAscii(wav, 36, 'data');
  view.setUint32(40, pcmSize, true);
  let offset = 44;
  parts.forEach((part: Uint8Array): void => { wav.set(part, offset); offset += part.byteLength; });
  return wav;
}

function xopcAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) target[offset + index] = value.charCodeAt(index);
}

export function xopcPcmDurationMs(byteLength: number): number {
  return Math.floor(byteLength / 32);
}

export function xopcAudioLevel(bytes: Uint8Array): number {
  if (bytes.byteLength < 2) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  const stride = Math.max(1, Math.floor(samples / 80));
  let total = 0;
  let count = 0;
  for (let index = 0; index < samples; index += stride) {
    total += Math.abs(view.getInt16(index * 2, true));
    count++;
  }
  return count ? Math.min(1, total / count / 9000) : 0;
}

export function xopcFormatCaptureTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return minutes + ':' + seconds;
}

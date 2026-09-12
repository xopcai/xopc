const OUTPUT_GAIN = 1.5;

/** Raise conversational PCM output without changing the device's system volume. */
export function applyVoiceOutputGain(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 2 !== 0) throw new Error('Voice output must contain aligned PCM samples');
  const output = new Uint8Array(bytes.byteLength);
  const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const outputView = new DataView(output.buffer);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    const amplified = Math.round(inputView.getInt16(offset, true) * OUTPUT_GAIN);
    outputView.setInt16(offset, Math.max(-32_768, Math.min(32_767, amplified)), true);
  }
  return output;
}

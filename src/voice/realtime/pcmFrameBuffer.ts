const PCM_24KHZ_20MS_BYTES = 960;

/** Converts arbitrary PCM16 chunks into exact 20 ms wire frames. */
export class PcmFrameBuffer {
  private remainder = new Uint8Array();

  push(bytes: Uint8Array): Uint8Array[] {
    if (!bytes.byteLength || bytes.byteLength % 2) throw new Error('PCM16 audio must contain complete samples');
    const pending = new Uint8Array(this.remainder.byteLength + bytes.byteLength);
    pending.set(this.remainder);
    pending.set(bytes, this.remainder.byteLength);
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset + PCM_24KHZ_20MS_BYTES <= pending.byteLength) {
      frames.push(pending.slice(offset, offset + PCM_24KHZ_20MS_BYTES));
      offset += PCM_24KHZ_20MS_BYTES;
    }
    this.remainder = pending.slice(offset);
    return frames;
  }

  finish(): Uint8Array | undefined {
    if (!this.remainder.byteLength) return undefined;
    const frame = new Uint8Array(PCM_24KHZ_20MS_BYTES);
    frame.set(this.remainder);
    this.remainder = new Uint8Array();
    return frame;
  }
}

export interface RecordingMediaCoverage {
  version: 1;
  verifiedThroughMs: number;
  observedThroughMs: number;
  status: 'verified' | 'unknown' | 'gap';
}

const MASTERS = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]);
const MAX_ELEMENT_BYTES = 16 * 1024 * 1024;

function vint(bytes: Uint8Array, offset: number, id = false): { value: number; width: number; unknown: boolean } | undefined {
  if (offset >= bytes.length) return;
  let width = 1;
  while (width <= 8 && !(bytes[offset] & (0x80 >> (width - 1)))) width++;
  if (width > (id ? 4 : 8)) throw new Error('Invalid EBML integer');
  if (offset + width > bytes.length) return;
  let value = id ? bytes[offset] : bytes[offset] & (0xff >> width);
  let unknown = !id && value === (0xff >> width);
  for (let index = 1; index < width; index++) { value = value * 256 + bytes[offset + index]; unknown &&= bytes[offset + index] === 255; }
  if (!unknown && !Number.isSafeInteger(value)) throw new Error('Oversized EBML integer');
  return { value, width, unknown };
}

function unsigned(bytes: Uint8Array): number {
  if (!bytes.length || bytes.length > 6) throw new Error('Invalid media timestamp');
  return bytes.reduce((sum, byte) => sum * 256 + byte, 0);
}

/** Incremental, conservative proof for Chrome's single-track WebM/Opus output. */
export class RecordingMediaCoverageReader {
  private pending = new Uint8Array(0);
  private offset = 0;
  private stack: Array<{ id: number; end: number }> = [];
  private timeScaleMs = 1;
  private clusterTime = 0;
  private track = 0;
  private trackType = 0;
  private opus = false;
  private audioTrack = 0;
  private observed = 0;
  private decoded = 0;
  private lastStart = -Infinity;
  private prefix = 0;
  private failed = false;
  private gap = false;

  constructor(private readonly mimeType: string) {}

  snapshot(): RecordingMediaCoverage {
    return { version: 1, verifiedThroughMs: Math.floor(this.prefix), observedThroughMs: Math.floor(this.observed),
      status: this.gap ? 'gap' : this.failed || !this.audioTrack || !this.observed ? 'unknown' : 'verified' };
  }

  packetClock(): { durationMs: number; verified: boolean } { return { durationMs: Math.floor(this.decoded),verified: !this.failed && !!this.audioTrack && this.decoded > 0 }; }

  append(bytes: Uint8Array): RecordingMediaCoverage {
    if (this.failed || !this.mimeType.includes('webm')) { this.failed = true; return this.snapshot(); }
    const merged = new Uint8Array(this.pending.length + bytes.length);
    merged.set(this.pending); merged.set(bytes, this.pending.length); this.pending = merged;
    let cursor = 0;
    try {
      while (cursor < merged.length) {
        const absolute = this.offset + cursor;
        while (this.stack.length && absolute >= this.stack.at(-1)!.end) this.stack.pop();
        const id = vint(merged, cursor, true); if (!id) break;
        const size = vint(merged, cursor + id.width); if (!size) break;
        const start = cursor + id.width + size.width;
        if (this.stack.length && this.offset + start + (size.unknown ? 0 : size.value) > this.stack.at(-1)!.end) throw new Error('Element exceeds its container');
        if (MASTERS.has(id.value)) {
          if (id.value === 0xa0) throw new Error('BlockGroup padding needs separate verification');
          if (id.value === 0x1f43b675) {
            // Unknown-sized clusters terminate when the next cluster begins.
            const cluster = this.stack.findIndex(entry => entry.id === 0x1f43b675);
            if (cluster >= 0) this.stack.length = cluster;
            this.clusterTime = 0;
          }
          if (id.value === 0xae) { this.track = 0; this.trackType = 0; this.opus = false; }
          if (this.stack.length > 12) throw new Error('Excessive media nesting');
          this.stack.push({ id: id.value, end: size.unknown ? Infinity : this.offset + start + size.value });
          cursor = start; continue;
        }
        if (size.unknown || size.value > MAX_ELEMENT_BYTES) throw new Error('Unsupported media element');
        if (start + size.value > merged.length) break;
        const payload = merged.subarray(start, start + size.value);
        if (id.value === 0x2ad7b1) {
          this.timeScaleMs = unsigned(payload) / 1_000_000;
          if (!this.timeScaleMs) throw new Error('Invalid media time scale');
        }
        if (id.value === 0x56aa && unsigned(payload) !== 0) throw new Error('Codec delay needs separate verification');
        if (id.value === 0xd7) this.track = unsigned(payload);
        if (id.value === 0x83) this.trackType = unsigned(payload);
        if (id.value === 0x86) this.opus = new TextDecoder().decode(payload) === 'A_OPUS';
        if (this.track && this.trackType === 2 && this.opus) {
          if (this.audioTrack && this.audioTrack !== this.track) throw new Error('Multiple audio tracks');
          this.audioTrack = this.track;
        }
        if (id.value === 0xe7) this.clusterTime = unsigned(payload);
        if (id.value === 0xa3 || id.value === 0xa1) this.block(payload);
        cursor = start + size.value;
      }
      if (merged.length - cursor > MAX_ELEMENT_BYTES) throw new Error('Incomplete oversized media element');
    } catch { this.failed = true; }
    this.offset += cursor;
    this.pending = this.failed ? new Uint8Array(0) : merged.slice(cursor);
    return this.snapshot();
  }

  private block(bytes: Uint8Array): void {
    const track = vint(bytes, 0);
    if (!track || bytes.length < track.width + 4 || track.value !== this.audioTrack) throw new Error('Unsupported media block');
    const header = track.width;
    if (bytes[header + 2] & 0x06) throw new Error('Laced audio needs separate verification');
    const relative = new DataView(bytes.buffer, bytes.byteOffset + header, 2).getInt16(0);
    const packet = bytes.subarray(header + 3);
    const config = packet[0] >> 3;
    const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : [10, 20, 40, 60][config & 3];
    const countCode = packet[0] & 3;
    const frames = countCode === 0 ? 1 : countCode === 3 ? (packet[1] ?? 0) & 63 : 2;
    const duration = frameMs * frames;
    if (!frames || duration > 120 || (countCode === 3 && packet.length < 2)) throw new Error('Invalid Opus packet');
    const start = (this.clusterTime + relative) * this.timeScaleMs;
    const end = start + duration;
    if (!Number.isFinite(end) || start < 0 || start <= this.lastStart) throw new Error('Non-monotonic media time');
    this.lastStart = start; this.decoded += duration;
    if (start !== this.observed) this.gap = true;
    this.observed = Math.max(this.observed, end);
    if (!this.gap) this.prefix = this.observed;
  }
}

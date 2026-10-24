import { PhoneError } from './contracts.js';

/** Only supplied text is sent to Android; clipboard autosync and reads stay off. */
export class ScrcpyTextChannel {
  private buffer = Buffer.alloc(0);
  private sequence = 0n;
  private pending = new Map<bigint, { resolve(): void; reject(error: Error): void }>();
  constructor(private write: (bytes: Buffer) => Promise<void>) {}
  receive(bytes: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    while (this.buffer.length) {
      const type = this.buffer[0];
      let length: number;
      if (type === 1) {
        if (this.buffer.length < 9) return;
        const seq = this.buffer.readBigUInt64BE(1);
        this.pending.get(seq)?.resolve(); this.pending.delete(seq); length = 9;
      } else if (type === 0 || type === 2) {
        if (this.buffer.length < 5) return;
        length = 5 + (type === 0 ? this.buffer.readUInt32BE(1) : this.buffer.readUInt16BE(3));
        if (length > 262144) throw new Error('Invalid device message');
        if (this.buffer.length < length) return;
      } else throw new Error('Unknown device message');
      this.buffer = this.buffer.subarray(length);
    }
  }
  async paste(text: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!text || text.length > 4000 || this.pending.size) throw new PhoneError('PHONE_INVALID_INPUT', 'Invalid or concurrent phone text input');
    const sequence = ++this.sequence; const payload = Buffer.from(text);
    const bytes = Buffer.alloc(14 + payload.length); bytes[0] = 9;
    bytes.writeBigUInt64BE(sequence, 1); bytes[9] = 1; bytes.writeUInt32BE(payload.length, 10); payload.copy(bytes, 14); payload.fill(0);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    let abort!: () => void;
    const ack = new Promise<void>((resolve, reject) => {
      abort = () => reject(new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Text may have been pasted. Take over and inspect the input field before retrying.', 409));
      this.pending.set(sequence, { resolve, reject }); deadline.addEventListener('abort', abort, { once: true });
    });
    try {
      // A lost ACK must never cause a second paste through another transport.
      await Promise.all([this.write(bytes), ack]);
    } catch {
      throw new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Text may have been pasted. Take over and inspect the input field before retrying.', 409);
    } finally { bytes.fill(0); deadline.removeEventListener('abort', abort); this.pending.delete(sequence); }
  }
  close(): void {
    for (const request of this.pending.values()) request.reject(new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Phone text channel disconnected; inspect the field before retrying.', 409));
    this.pending.clear(); this.buffer.fill(0); this.buffer = Buffer.alloc(0);
  }
}

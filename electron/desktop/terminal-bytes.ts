import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

import { canonicalJson, desktopTerminalBindingSchema, desktopTerminalInputSchema, desktopTerminalOutputAckSchema,
  DESKTOP_TERMINAL_OUTPUT_BYTES, type DesktopTerminalBinding, type DesktopTerminalDispatch, type DesktopTerminalOutput } from '@xopcai/endpoint-tools-protocol';

export interface DesktopTerminalInputLedger {
  find(inputId: string): Promise<{ fingerprint: string; sequence: number; dispatch: DesktopTerminalDispatch } | undefined>;
  record(inputId: string, fingerprint: string, sequence: number): Promise<void>;
  finish(inputId: string, dispatch: Exclude<DesktopTerminalDispatch, 'pending'>): Promise<void>;
}

/** Bounded, ordered byte flow. An input acknowledgement means dispatch only, never command completion or executor stop. */
export class DesktopTerminalBytes {
  private readonly binding: DesktopTerminalBinding;
  private outputSequence = 0;
  private acknowledged = 0;
  private inputSequence: number;
  private readonly outstanding = new Map<number, number>();
  private queued = Buffer.alloc(0);
  private busy = false;
  private closed = false;
  private blocked = false;
  private streamClosed = false;
  private readonly closing = new AbortController();
  private readonly watchdog: ReturnType<typeof setInterval>;
  constructor(private readonly options: {
    binding: DesktopTerminalBinding; socket: Duplex; ledger: DesktopTerminalInputLedger; lastInputSequence: number;
    current(): boolean; emit(frame: DesktopTerminalOutput): void;
    onUnknown(reason: string): void; onStreamClosed(): void;
  }) {
    this.binding = desktopTerminalBindingSchema.parse(options.binding);
    if (!Number.isSafeInteger(options.lastInputSequence) || options.lastInputSequence < 0 || !options.current()) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
    this.inputSequence = options.lastInputSequence; options.socket.pause();
    options.socket.on('data', this.data); options.socket.on('error', this.error); options.socket.on('end', this.ended); options.socket.on('close', this.ended);
    this.watchdog = setInterval(() => { if (!this.options.current()) this.fail('DESKTOP_TERMINAL_AUTHORITY_INVALID'); }, 250); this.watchdog.unref();
  }
  private matches(binding: DesktopTerminalBinding) {
    return binding.sessionId === this.binding.sessionId && binding.generation === this.binding.generation && binding.connectionInstanceId === this.binding.connectionInstanceId;
  }
  private requireCurrent() {
    if (this.closed || this.blocked || !this.options.current()) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
  }
  startOutput() { this.requireCurrent(); this.pump(); }
  private readonly data = (bytes: Buffer) => {
    if (this.closed || this.blocked) return;
    if (!this.options.current() || bytes.length > 65536 || this.queued.length + bytes.length > 65536) { this.fail('DESKTOP_TERMINAL_OUTPUT_LIMIT'); return; }
    this.queued = Buffer.concat([this.queued, bytes]); this.pump();
  };
  private pump() {
    if (this.closed || this.blocked) return;
    while (this.queued.length && this.outstanding.size < 16) {
      const bytes = this.queued.subarray(0, DESKTOP_TERMINAL_OUTPUT_BYTES); this.queued = this.queued.subarray(bytes.length);
      const sequence = ++this.outputSequence;
      if (!Number.isSafeInteger(sequence)) { this.fail('DESKTOP_TERMINAL_SEQUENCE_LIMIT'); return; }
      this.outstanding.set(sequence, bytes.length);
      try { this.options.emit({ ...this.binding, sequence, bytes: bytes.toString('base64') }); }
      catch { this.fail('DESKTOP_TERMINAL_OUTPUT_UNKNOWN'); return; }
    }
    if (this.outstanding.size >= 16) this.options.socket.pause(); else this.options.socket.resume();
  }
  acknowledge(input: unknown) {
    this.requireCurrent(); const ack = desktopTerminalOutputAckSchema.parse(input);
    if (!this.matches(ack) || ack.throughSequence > this.outputSequence) throw new Error('DESKTOP_TERMINAL_ACK_INVALID');
    if (ack.throughSequence <= this.acknowledged) return;
    this.acknowledged = ack.throughSequence;
    for (const sequence of this.outstanding.keys()) if (sequence <= this.acknowledged) this.outstanding.delete(sequence);
    this.pump();
  }
  async input(value: unknown, signal: AbortSignal): Promise<{ inputId: string; sequence: number; dispatch: Exclude<DesktopTerminalDispatch, 'pending'> }> {
    this.requireCurrent(); signal.throwIfAborted(); const input = desktopTerminalInputSchema.parse(value);
    const bytes = Buffer.from(input.bytes, 'base64');
    if (!this.matches(input) || bytes.toString('base64') !== input.bytes) throw new Error('DESKTOP_TERMINAL_INPUT_IDENTITY_MISMATCH');
    if (this.busy) throw new Error('DESKTOP_TERMINAL_INPUT_BUSY');
    this.busy = true; let dispatched = false, recorded = false;
    const fingerprint = createHash('sha256').update(canonicalJson(input)).digest('hex');
    try {
      const previous = await this.options.ledger.find(input.inputId); this.requireCurrent();
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.sequence !== input.sequence) throw new Error('DESKTOP_TERMINAL_INPUT_IDENTITY_MISMATCH');
        if (previous.dispatch === 'pending' || previous.dispatch === 'unknown') { this.fail('DESKTOP_TERMINAL_INPUT_UNKNOWN'); return { inputId: input.inputId, sequence: input.sequence, dispatch: 'unknown' }; }
        this.inputSequence = Math.max(this.inputSequence, previous.sequence);
        return { inputId: input.inputId, sequence: input.sequence, dispatch: previous.dispatch };
      }
      if (input.sequence !== this.inputSequence + 1 || input.sequence > 1000) throw new Error('DESKTOP_TERMINAL_INPUT_SEQUENCE_INVALID');
      await this.options.ledger.record(input.inputId, fingerprint, input.sequence); recorded = true;
      this.inputSequence = input.sequence; this.requireCurrent(); signal.throwIfAborted();
      dispatched = true;
      await this.write(bytes, AbortSignal.any([signal, this.closing.signal]));
      await this.options.ledger.finish(input.inputId, 'accepted');
      return { inputId: input.inputId, sequence: input.sequence, dispatch: 'accepted' };
    } catch (error) {
      if (recorded) {
        const dispatch = dispatched ? 'unknown' : 'notStarted';
        try { await this.options.ledger.finish(input.inputId, dispatch); } catch { /* The pending record prevents replay after recovery. */ }
        this.fail('DESKTOP_TERMINAL_INPUT_UNKNOWN');
      } else if (!(error instanceof Error && /IDENTITY_MISMATCH|SEQUENCE_INVALID/.test(error.message))) this.fail('DESKTOP_TERMINAL_LEDGER_UNAVAILABLE');
      throw error;
    } finally { bytes.fill(0); this.busy = false; }
  }
  private write(bytes: Buffer, signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error('DESKTOP_TERMINAL_INPUT_UNKNOWN')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      try { this.options.socket.write(bytes, error => { cleanup(); error ? reject(new Error('DESKTOP_TERMINAL_INPUT_UNKNOWN')) : resolve(); }); }
      catch { cleanup(); reject(new Error('DESKTOP_TERMINAL_INPUT_UNKNOWN')); }
    });
  }
  private readonly error = () => { this.fail('DESKTOP_TERMINAL_STREAM_UNKNOWN'); };
  private readonly ended = () => { if (!this.closed && !this.streamClosed) { this.streamClosed = true; this.options.onStreamClosed(); } };
  private fail(reason: string) { if (this.blocked || this.closed) return; this.blocked = true; clearInterval(this.watchdog); this.options.socket.pause(); this.options.socket.destroy(); this.closing.abort(); this.options.onUnknown(reason); }
  close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.watchdog); this.closing.abort();
    this.options.socket.off('data', this.data).off('error', this.error).off('end', this.ended).off('close', this.ended);
    this.options.socket.pause(); this.options.socket.destroy(); this.queued.fill(0); this.queued = Buffer.alloc(0); this.outstanding.clear();
  }
}

import { PhoneError } from './contracts.js';

export interface PhoneTextProvider {
  pasteText(text: string, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

/** One operation owns the channel. A failed paste is never replayed on a replacement. */
export class PhoneTextSession {
  private provider?: PhoneTextProvider;
  private closing: Promise<void> = Promise.resolve();
  private busy = false;
  constructor(private create: (failed: () => void) => Promise<PhoneTextProvider>) {}
  async paste(text: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.busy) throw new PhoneError('PHONE_INVALID_INPUT', 'Concurrent phone text input is not allowed');
    this.busy = true;
    try {
      await this.closing; signal.throwIfAborted();
      const provider = this.provider ??= await this.create(() => { void this.close().catch(() => {}); });
      signal.throwIfAborted(); await provider.pasteText(text, signal);
    } catch (error) { await this.close().catch(() => {}); throw error; }
    finally { this.busy = false; }
  }
  async close(): Promise<void> {
    const provider = this.provider; this.provider = undefined;
    if (provider) this.closing = this.closing.catch(() => {}).then(() => provider.close());
    await this.closing;
  }
}

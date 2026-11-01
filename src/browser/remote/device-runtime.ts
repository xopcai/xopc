import { BrowserRuntime } from '../runtime/browser-runtime.js';

/** An idle callback must never collect a runtime while a first browser call is still being admitted. */
export class RemoteDeviceBrowserRuntime extends BrowserRuntime {
  private calls = 0;
  constructor(options: ConstructorParameters<typeof BrowserRuntime>[0], private readonly idle: () => void) { super({ ...options, retainSessionsUntilStopped: true }); }
  override async execute(...args: Parameters<BrowserRuntime['execute']>): ReturnType<BrowserRuntime['execute']> {
    this.calls += 1;
    try { return await super.execute(...args); }
    finally { this.calls -= 1; if (!this.calls && !this.hasSessions()) this.idle(); }
  }
}

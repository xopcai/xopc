/** Relaunch is armed only after the existing local quit gate and process cleanup complete. */
export class GatewayModeRelaunch {
  private requested = false;
  constructor(private readonly options: { quit(): void; relaunch(args: string[]): void; entry?: string }) {}
  request() { this.requested = true; this.options.quit(); }
  cancel() { this.requested = false; }
  finishCleanup() {
    if (!this.requested) return;
    this.requested = false;
    this.options.relaunch([...(this.options.entry ? [this.options.entry] : []), '--gateway-connections']);
  }
}

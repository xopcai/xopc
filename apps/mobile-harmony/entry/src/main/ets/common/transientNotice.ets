export const XOPC_TRANSIENT_NOTICE_MS: number = 6000;

/** Presentation lifetime only; dismissing a notice never cancels the failed operation's recoverable data. */
export class XopcTransientNotice {
  private timer: number = -1;
  private publish: (message: string) => void;

  constructor(publish: (message: string) => void) { this.publish = publish; }

  show(message: string): void {
    this.clear();
    if (!message) return;
    this.publish(message);
    this.timer = setTimeout((): void => { this.timer = -1; this.publish(''); }, XOPC_TRANSIENT_NOTICE_MS);
  }

  clear(): void {
    if (this.timer !== -1) clearTimeout(this.timer);
    this.timer = -1;
    this.publish('');
  }
}

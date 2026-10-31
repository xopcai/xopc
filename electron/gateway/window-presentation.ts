type RecoverableWindow = { isDestroyed(): boolean; show(): void; focus(): void };

/** Presentation only; background acceptance must not change connection or capability authority. */
export class RemoteWindowPresentation {
  constructor(private background = false) {}

  get showInitially(): boolean { return !this.background; }

  reveal(window: RecoverableWindow, explicitUserRequest = false): void {
    if (window.isDestroyed()) return;
    if (explicitUserRequest) this.background = false;
    if (this.background) return;
    window.show();
    window.focus();
  }
}

export type QuitConfirmationStep = 'allow' | 'block' | 'confirm';

/**
 * Coordinates Electron's synchronous `before-quit` event with an asynchronous native dialog.
 * One accepted or explicitly bypassed quit also permits the follow-up `app.quit()` used after cleanup.
 */
export class QuitConfirmationGate {
  private accepted = false;
  private bypassNext = false;
  private pending = false;

  begin(canConfirm: boolean): QuitConfirmationStep {
    if (this.accepted) return 'allow';
    if (this.bypassNext || !canConfirm) {
      this.bypassNext = false;
      this.accepted = true;
      return 'allow';
    }
    if (this.pending) return 'block';
    this.pending = true;
    return 'confirm';
  }

  resolve(confirmed: boolean): boolean {
    if (!this.pending) return false;
    this.pending = false;
    if (confirmed) this.accepted = true;
    return confirmed;
  }

  bypass(): void {
    this.bypassNext = true;
  }
}

export const appQuitConfirmationGate = new QuitConfirmationGate();

/** Use only after another explicit flow already confirmed an app restart or exit. */
export function bypassNextAppQuitConfirmation(): void {
  appQuitConfirmationGate.bypass();
}

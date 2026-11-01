import type { BrowserWindow } from 'electron';

import { ComputerWorkspaceVisibility } from '../computer/workspace-visibility.js';
import { createLogger } from '../../src/utils/logger.js';

const log = createLogger('DesktopComputerPresence');

type Parent = Parameters<ComputerWorkspaceVisibility['begin']>[0] & Pick<BrowserWindow, 'isVisible' | 'isMinimized' | 'on'>;

/** Explicit native Computer consent keeps its trusted stop UI visible while the approved target owns focus. */
export class DesktopComputerPresence {
  private readonly workspace = new ComputerWorkspaceVisibility();
  private grant?: { parent: Parent; current(): boolean; signal: AbortSignal; cleanup(): void };
  private preparing = false;
  private entering?: Promise<void>;
  constructor(private readonly onRevoke?: () => void) {}
  begin(parent: Parent, current: () => boolean, signal: AbortSignal, platform = process.platform): Promise<void> {
    if (this.entering) return Promise.reject(new Error('DESKTOP_COMPUTER_BUSY'));
    const pending = this.enter(parent, current, signal, platform); this.entering = pending;
    void pending.finally(() => { if (this.entering === pending) this.entering = undefined; }).catch(() => {});
    return pending;
  }
  private async enter(parent: Parent, current: () => boolean, signal: AbortSignal, platform: NodeJS.Platform): Promise<void> {
    this.close(); signal.throwIfAborted();
    if (!current() || parent.isDestroyed() || !parent.isVisible() || parent.isMinimized()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    const revoke = () => { if (this.grant === grant) this.close('minimized-or-closed'); };
    // Electron's workspace policy may queue a hide notification after the window is already visible again.
    const hidden = () => { if (!this.preparing && this.grant === grant && !parent.isVisible()) this.close('hide-event'); };
    const grant = { parent, current, signal, cleanup: () => {
      parent.removeListener('minimize', revoke); parent.removeListener('closed', revoke); parent.removeListener('hide', hidden);
    } }; this.grant = grant; this.preparing = true;
    parent.on('minimize', revoke); parent.on('closed', revoke); parent.on('hide', hidden);
    try {
      await this.workspace.begin(parent, signal, platform);
      if (this.grant === grant) this.preparing = false;
      if (this.grant !== grant || !this.visible()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
    } catch (error) { if (this.grant === grant) this.close(); throw error; }
  }
  async whenStopped(): Promise<void> { await this.entering?.catch(() => {}); }
  visible(): boolean {
    const grant = this.grant;
    if (!grant) return false;
    try {
      if (grant.signal.aborted) { this.close('aborted'); return false; }
      if (!grant.current()) { this.close('stale-context'); return false; }
      if (grant.parent.isDestroyed() || grant.parent.isMinimized()) { this.close('parent-unavailable'); return false; }
      if (!this.workspace.active || !grant.parent.isVisible()) { if (!this.preparing) this.close('workspace-or-visibility'); return false; }
      return true;
    } catch { this.close('presence-check-failed'); return false; }
  }
  close(reason = 'stopped'): void {
    const grant = this.grant; this.grant = undefined; this.preparing = false;
    grant?.cleanup(); this.workspace.close();
    if (grant) { if (reason !== 'stopped') log.warn({ phase: 'native_presence', reason }, 'Computer presence revoked'); this.onRevoke?.(); }
  }
}

import type { BrowserWindow } from 'electron';
import { createLogger } from '../../src/utils/logger.js';

type WorkspaceWindow = Pick<BrowserWindow, 'isDestroyed' | 'isVisibleOnAllWorkspaces' | 'setVisibleOnAllWorkspaces'
  | 'isFullScreen' | 'setFullScreen' | 'once' | 'removeListener'>;
const log = createLogger('ComputerWorkspace');

/** Keep the chat reachable during Space changes, restoring its original policy when the lease ends. */
export class ComputerWorkspaceVisibility {
  private cleanup?: () => void;
  private following = false;
  private preparing = false;
  get active(): boolean { return this.following; }
  get transitioning(): boolean { return this.preparing; }
  async begin(window: WorkspaceWindow, signal: AbortSignal, platform: NodeJS.Platform = process.platform): Promise<void> {
    this.close();
    signal.throwIfAborted();
    if (platform !== 'darwin' || window.isDestroyed()) return;
    const original = window.isVisibleOnAllWorkspaces();
    const fullscreen = window.isFullScreen();
    let changed = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', close);
      this.following = false; this.cleanup = undefined;
      if (window.isDestroyed()) return;
      try {
        if (changed) window.setVisibleOnAllWorkspaces(original);
        if (fullscreen) window.setFullScreen(true);
      } catch { log.warn({ phase: 'workspace_restore' }, 'Computer chat window workspace restoration failed'); }
    };
    this.cleanup = close;
    signal.addEventListener('abort', close, { once: true });
    this.preparing = true;
    try {
      // A native fullscreen window owns its own Space and cannot follow another
      // application. Wait for that transition before enabling all-workspace visibility.
      if (fullscreen) await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timer); window.removeListener('leave-full-screen', left); signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const left = () => finish();
        const aborted = () => finish(signal.reason);
        const timer = setTimeout(() => finish(new Error('COMPUTER_WINDOW_READY_TIMEOUT')), 5000);
        window.once('leave-full-screen', left); signal.addEventListener('abort', aborted, { once: true });
        try { window.setFullScreen(false); } catch (error) { finish(error); }
        if (signal.aborted) aborted();
      });
      signal.throwIfAborted();
      if (window.isDestroyed()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
      if (!original) {
        changed = true;
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      this.following = true;
    } catch (error) { close(); throw error; }
    finally { this.preparing = false; }
  }
  close(): void { this.cleanup?.(); }
}

import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';

export const CONNECTION_CHANNELS = ['connections:snapshot', 'connections:save', 'connections:select', 'connections:remove',
  'connections:local', 'connections:quit'] as const;

/** Startup-only boundary for the isolated remote-preview runtime, never installed in local main. */
export function installConnectionIpcBoundary(ipc: IpcMain, authorize: (event: IpcMainEvent | IpcMainInvokeEvent, channel: string) => void): void {
  for (const method of ['handle', 'handleOnce'] as const) {
    const original = ipc[method].bind(ipc);
    ipc[method] = (channel, listener) => original(channel, (event, ...args) => {
      authorize(event, channel);
      return listener(event, ...args);
    });
  }
  // Rejected fire-and-forget messages must not execute a handler or crash main.
  for (const method of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener'] as const) {
    const original = ipc[method].bind(ipc);
    ipc[method] = (channel, listener) => original(channel, Object.assign(function (event, ...args) {
      try { authorize(event, channel); }
      catch {
        for (const port of event.ports ?? []) {
          try { port.close(); } catch { /* A transferred port may already be closed. */ }
        }
        return;
      }
      return listener.call(this, event, ...args);
    }, { listener }));
  }
}

export class ConnectionWindowPolicy {
  private window?: WebContents;
  private document?: string;
  private revoked = false;

  register(window: WebContents, document: string): void {
    if (this.window) throw new Error('CONNECTION_WINDOW_ALREADY_REGISTERED');
    this.window = window;
    this.document = document;
  }

  revoke(): void { this.revoked = true; }

  authorize(event: IpcMainEvent | IpcMainInvokeEvent, channel: string): void {
    if (!CONNECTION_CHANNELS.includes(channel as typeof CONNECTION_CHANNELS[number])) throw new Error('REMOTE_CAPABILITY_DISABLED');
    if (this.revoked || !this.window || event.sender !== this.window || this.window.isDestroyed()
      || event.senderFrame !== this.window.mainFrame || event.senderFrame?.url !== this.document
      || this.window.getURL() !== this.document) throw new Error('UNTRUSTED_CONNECTION_WINDOW');
  }
}

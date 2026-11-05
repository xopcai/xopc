import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

import { isEmbeddedGatewayLoopbackUrl } from '../loopback-url.js';

let desktopOrigin: string | undefined;
export function setTrustedDesktopOrigin(origin: string): void { desktopOrigin = origin; }

export function isTrustedElectronRendererUrl(raw: string | undefined): boolean {
  if (typeof raw !== 'string') return false;
  if (!desktopOrigin) return isEmbeddedGatewayLoopbackUrl(raw);
  try { const url = new URL(raw); return url.origin === desktopOrigin && ['/', '/index.html'].includes(url.pathname); } catch { return false; }
}

export function assertTrustedRenderer(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url;
  const contentsUrl = event.sender.getURL();
  if (desktopOrigin ? event.senderFrame === event.sender.mainFrame && isTrustedElectronRendererUrl(frameUrl) && isTrustedElectronRendererUrl(contentsUrl)
    : isTrustedElectronRendererUrl(frameUrl) || isTrustedElectronRendererUrl(contentsUrl)) {
    return;
  }
  throw new Error('IPC denied from untrusted renderer');
}

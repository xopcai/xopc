import type { IpcMainInvokeEvent } from 'electron';

import { isEmbeddedGatewayLoopbackUrl } from '../loopback-url.js';

export function isTrustedElectronRendererUrl(raw: string | undefined): boolean {
  return typeof raw === 'string' && isEmbeddedGatewayLoopbackUrl(raw);
}

export function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url;
  const contentsUrl = event.sender.getURL();
  if (isTrustedElectronRendererUrl(frameUrl) || isTrustedElectronRendererUrl(contentsUrl)) {
    return;
  }
  throw new Error('IPC denied from untrusted renderer');
}

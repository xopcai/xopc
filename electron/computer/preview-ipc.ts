import { ipcMain, MessageChannelMain, type IpcMainInvokeEvent } from 'electron';
import { ComputerPreviewRequestSchema } from '@xopcai/computer-control-contract';
import type { DesktopEndpointHost } from './desktop-host.js';

/** Host validation is shared with the existing Computer IPC surface. */
export function registerComputerPreviewIpc(host: () => DesktopEndpointHost | undefined,
  assertRenderer: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle('computer:focus-target', async (event, conversationId: string, previewId: string) => {
    assertRenderer(event);
    ComputerPreviewRequestSchema.parse({ conversationId });
    if (typeof previewId !== 'string' || !previewId || previewId.length > 200) throw new Error('COMPUTER_PREVIEW_INVALID_REQUEST');
    const desktop = host();
    if (!desktop) throw new Error('COMPUTER_PREVIEW_UNAVAILABLE');
    await desktop.focusComputer(conversationId, previewId);
  });
  ipcMain.handle('computer-preview:current', (event, conversationId: string) => {
    assertRenderer(event);
    const request = ComputerPreviewRequestSchema.parse({ conversationId });
    return host()?.preview.current(request.conversationId);
  });
  ipcMain.handle('computer-preview:subscribe', (event, raw: unknown, requestId: string) => {
    assertRenderer(event);
    const request = ComputerPreviewRequestSchema.parse(raw);
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) throw new Error('COMPUTER_PREVIEW_INVALID_REQUEST');
    const desktop = host();
    if (!desktop) throw new Error('COMPUTER_PREVIEW_UNAVAILABLE');
    const { port1, port2 } = new MessageChannelMain();
    let subscriptionId: string;
    try {
      subscriptionId = desktop.preview.subscribe(request.conversationId, request.runId, request.preset,
        { send: message => port1.postMessage(message), close: () => port1.close() });
    } catch (error) { port1.close(); port2.close(); throw error; }
    port1.on('message', ({ data }) => {
      if (data?.kind === 'ack' && Number.isSafeInteger(data.streamEpoch) && Number.isSafeInteger(data.sequence)) {
        desktop.preview.acknowledge(subscriptionId, data.streamEpoch, data.sequence);
      }
    });
    port1.once('close', () => desktop.preview.unsubscribe(subscriptionId));
    port1.start();
    event.senderFrame!.postMessage('computer-preview:port', { requestId }, [port2]);
    return { subscriptionId };
  });
  ipcMain.handle('computer-preview:preset', (event, id: string, preset: unknown) => {
    assertRenderer(event);
    if (typeof preset !== 'string' || !['compact', 'expanded', 'paused'].includes(preset)) throw new Error('COMPUTER_PREVIEW_INVALID_PRESET');
    host()?.preview.setPreset(id, preset as 'compact' | 'expanded' | 'paused');
  });
  ipcMain.handle('computer-preview:unsubscribe', (event, id: string) => { assertRenderer(event); host()?.preview.unsubscribe(id); });
  ipcMain.handle('computer-preview:stop-control', async (event, id: string) => {
    assertRenderer(event); const desktop = host();
    if (!desktop) throw new Error('COMPUTER_PREVIEW_UNAVAILABLE');
    await desktop.stopPreviewControl(id);
  });
}

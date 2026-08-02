export const LOCAL_APP_PREVIEW_CONNECT_MESSAGE = Object.freeze({
  source: 'xopc-local-app-host',
  version: 1,
  type: 'connect',
});

/** Attach a private channel immediately and after load; preview messages never use the shared window bus. */
export function attachLocalAppPreviewChannel(
  iframe: HTMLIFrameElement,
  onMessage: (value: unknown) => void,
): () => void {
  let port: MessagePort | null = null;
  const connect = () => {
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (event: MessageEvent<unknown>) => onMessage(event.data);
    port.start();
    iframe.contentWindow?.postMessage(LOCAL_APP_PREVIEW_CONNECT_MESSAGE, '*', [channel.port2]);
  };
  iframe.addEventListener('load', connect);
  connect();
  return () => {
    iframe.removeEventListener('load', connect);
    port?.close();
  };
}

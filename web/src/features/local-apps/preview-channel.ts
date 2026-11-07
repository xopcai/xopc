export const LOCAL_APP_PREVIEW_CONNECT_MESSAGE = Object.freeze({
  source: 'xopc-local-app-host',
  version: 1,
  type: 'connect',
});

/** Attach a private channel immediately and after load; preview messages never use the shared window bus. */
export function attachLocalAppPreviewChannel(
  iframe: HTMLIFrameElement,
  onMessage: (value: unknown) => void,
  options?: { runId: string; beforeRun: () => Promise<void>; onError: (error: unknown) => void },
): () => void {
  let port: MessagePort | null = null;
  let generation = 0;
  let tick: ReturnType<typeof setInterval> | undefined;
  const connect = () => {
    const current = ++generation;
    if (tick) clearInterval(tick);
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    let starting = false;
    let completed = false;
    port.onmessage = (event: MessageEvent<{ type?: string; runId?: string }>) => {
      if (current !== generation || event.data?.runId && event.data.runId !== options?.runId) return;
      onMessage(event.data);
      if (event.data?.type === 'acceptance') { completed = true; if (tick) clearInterval(tick); }
      if (event.data?.type === 'ready' && options && !starting) {
        starting = true;
        void options.beforeRun().then(() => {
          if (current !== generation || completed) return;
          port?.postMessage({ type: 'run', runId: options.runId });
          tick = setInterval(() => port?.postMessage({ type: 'tick' }), 25);
        }).catch(error => { if (current === generation) options.onError(error); });
      }
    };
    port.start();
    iframe.contentWindow?.postMessage(LOCAL_APP_PREVIEW_CONNECT_MESSAGE, '*', [channel.port2]);
  };
  iframe.addEventListener('load', connect);
  connect();
  return () => {
    generation++;
    if (tick) clearInterval(tick);
    iframe.removeEventListener('load', connect);
    port?.close();
  };
}

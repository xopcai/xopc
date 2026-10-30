import { ipcRenderer } from 'electron';

/** Isolated preload: receives one host-selected window, never arbitrary renderer requests. */
ipcRenderer.once('computer-preview:worker', (event, input: { sourceId: string; preset: 'compact' | 'expanded' }) => {
  const port = event.ports[0];
  if (!port || !/^window:\d+:0$/.test(input.sourceId)) return;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, waiting = false, encoding = false;
  let lastHash: number | undefined, quietFrames = 0;
  let preset = input.preset;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d', { alpha: false });
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null; port.close();
  };
  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer); timer = setTimeout(() => { void capture(); }, quietFrames >= 3 ? 500 : preset === 'expanded' ? 1000 / 15 : 125);
  };
  const capture = async () => {
    if (stopped || waiting || encoding) return;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2 || !context) { schedule(); return; }
    encoding = true;
    const dimension = preset === 'expanded' ? 1600 : 1280;
    const scale = Math.min(1, dimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .92 });
      if (stopped) return;
      const bytes = await blob.arrayBuffer();
      if (stopped) return;
      let hash = 2166136261;
      for (const byte of new Uint8Array(bytes)) hash = Math.imul(hash ^ byte, 16777619);
      quietFrames = hash === lastHash ? quietFrames + 1 : 0; lastHash = hash;
      waiting = true;
      // Electron's main-side port transfers ports, not ArrayBuffer ownership.
      port.postMessage({ kind: 'frame', width: canvas.width, height: canvas.height, bytes });
    } catch { port.postMessage({ kind: 'error' }); stop(); }
    finally { encoding = false; if (!waiting) schedule(); }
  };
  port.onmessage = event => {
    if (event.data?.kind === 'ack') { waiting = false; schedule(); }
    if (event.data?.kind === 'preset') {
      preset = event.data.preset === 'expanded' ? 'expanded' : 'compact';
      quietFrames = 0;
      void stream?.getVideoTracks()[0]?.applyConstraints({ width: { max: preset === 'expanded' ? 1600 : 1280 },
        height: { max: preset === 'expanded' ? 1600 : 1280 }, frameRate: { max: preset === 'expanded' ? 15 : 8 } }).catch(() => {});
    }
  };
  port.onmessageerror = stop;
  port.addEventListener('close', stop);
  window.addEventListener('unload', stop, { once: true });
  port.start();
  void navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
    chromeMediaSource: 'desktop', chromeMediaSourceId: input.sourceId,
    maxWidth: preset === 'expanded' ? 1600 : 1280, maxHeight: preset === 'expanded' ? 1600 : 1280,
    maxFrameRate: preset === 'expanded' ? 15 : 8,
  } } as MediaTrackConstraints }).then(async value => {
    if (stopped) { value.getTracks().forEach(track => track.stop()); return; }
    stream = value;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stopped) port.postMessage({ kind: 'error' }); stop(); }, { once: true });
    video.srcObject = stream; await video.play(); void capture();
  }).catch(() => { if (!stopped) port.postMessage({ kind: 'error' }); stop(); });
});

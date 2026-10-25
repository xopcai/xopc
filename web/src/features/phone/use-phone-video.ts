import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { phoneClientId } from './phone-live-api';

type Geometry = { width: number; height: number; version: number; codec: string };
type VideoState = { status: 'connecting' | 'playing' | 'blocked' | 'fallback'; geometry?: Geometry; error?: string; fps: number; ackMs?: number; frames: number };
export function usePhoneVideo(conversationId: string, sessionId: string, enabled: boolean, canvas: RefObject<HTMLCanvasElement | null>, epoch: number | undefined) {
  const [state, setState] = useState<VideoState>({ status: 'connecting', fps: 0, frames: 0 });
  const [attempt, setAttempt] = useState(0);
  const current = useRef({ epoch, geometry: undefined as Geometry | undefined }); current.current.epoch = epoch;
  const socket = useRef<WebSocket | null>(null); const seq = useRef(0); const down = useRef(false);
  const move = useRef<number[] | undefined>(undefined); const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendTimes = useRef(new Map<number, number>()); const ackMs = useRef<number | undefined>(undefined);
  const sendPointer = useCallback((phase: 'down' | 'move' | 'up' | 'cancel', point: number[]) => {
    const ws = socket.current; const g = current.current.geometry;
    if (!ws || ws.readyState !== WebSocket.OPEN || !g || !current.current.epoch) return false;
    if (ws.bufferedAmount > 16 * 1024) { ws.close(); return false; }
    const id = ++seq.current; sendTimes.current.set(id, performance.now());
    if (sendTimes.current.size > 120) { ws.close(); return false; }
    ws.send(JSON.stringify({ type: 'pointer', phase, seq: id, epoch: current.current.epoch, geometry: g.version, x: point[0], y: point[1] })); return true;
  }, []);
  const cancel = useCallback(() => {
    clearTimeout(moveTimer.current); moveTimer.current = undefined; move.current = undefined;
    if (down.current && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'cancelPointers', epoch: current.current.epoch }));
    down.current = false;
  }, []);
  const flushMove = useCallback(() => {
    moveTimer.current = undefined;
    if (!down.current || !move.current || sendTimes.current.size) return;
    const point = move.current; move.current = undefined;
    sendPointer('move', point);
  }, [sendPointer]);
  const pointer = useCallback((phase: 'down' | 'move' | 'up' | 'cancel', point: number[]) => {
    if (phase === 'cancel') { cancel(); return; }
    if (phase === 'down') { cancel(); down.current = sendPointer('down', point); return; }
    if (!down.current) return;
    if (phase === 'move') {
      move.current = point;
      // Keep only the latest MOVE while the transport is waiting for an ACK.
      if (!moveTimer.current) moveTimer.current = setTimeout(flushMove, 24);
    } else {
      clearTimeout(moveTimer.current); moveTimer.current = undefined; move.current = undefined;
      sendPointer('up', point); down.current = false;
    }
  }, [cancel, sendPointer, flushMove]);
  useEffect(() => {
    if (!enabled) return;
    if (!('VideoDecoder' in window) || !window.isSecureContext) { setState({ status: 'fallback', error: 'WebCodecs unavailable', fps: 0, frames: 0 }); return; }
    const connectAt = performance.now();
    let disposed = false; let decoder: VideoDecoder | undefined; let config: Uint8Array | undefined; let key = false;
    let frames = 0; let previousFrames = 0; let lastAt = performance.now(); let first = true; let renderAllowed = true;
    let lastFault = '';
    setState({ status: 'connecting', fps: 0, frames: 0 });
    const clear = () => { const element = canvas.current; if (element) element.getContext('2d')?.clearRect(0, 0, element.width, element.height); };
    const fallback = (error: string) => { if (disposed) return; clearTimeout(firstTimer); renderAllowed = false; clear(); setState(s => ({ ...s, status: 'fallback', error })); socket.current?.close(); };
    const firstTimer = setTimeout(() => { if (!frames) fallback('Phone video first frame timed out'); }, 8000);
    const statsTimer = setInterval(() => {
      const at = performance.now(); const fps = (frames - previousFrames) * 1000 / (at - lastAt); previousFrames = frames; lastAt = at;
      if (!disposed) setState(s => ({ ...s, fps, frames, ackMs: ackMs.current }));
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'ping' }));
    }, 2000);
    const connect = async () => {
      try {
        const result = await fetchJson<{ payload: { ticket: string; path: string } }>(apiUrl(`/api/phone/conversations/${conversationId}/${sessionId}/video-ticket`), { method: 'POST', body: JSON.stringify({ clientId: phoneClientId }) });
        if (disposed) return;
        const url = new URL(apiUrl(result.payload.path)); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(url, ['xopc-phone-v1', result.payload.ticket]); socket.current = ws; ws.binaryType = 'arraybuffer';
        ws.onmessage = event => {
          if (disposed) return;
          try {
            if (typeof event.data === 'string') {
              const message = JSON.parse(event.data);
              if (message.type === 'geometry') {
                cancel(); current.current.geometry = message; first = true; renderAllowed = false;
                if (decoder && decoder.state !== 'closed') decoder.close(); key = false;
                decoder = new VideoDecoder({ output: frame => {
                  try {
                    const element = canvas.current;
                    if (!disposed && renderAllowed && element) {
                      if (element.width !== frame.displayWidth || element.height !== frame.displayHeight) { element.width = frame.displayWidth; element.height = frame.displayHeight; }
                      element.getContext('2d', { alpha: false })?.drawImage(frame, 0, 0); frames++;
                      if (frames === 1) element.dataset.phoneFirstFrameMs = (performance.now() - connectAt).toFixed(1);
                      element.dataset.phonePresentedFrames = String(frames); element.dataset.phoneLastPresentation = performance.now().toFixed(1);
                      if (first) { first = false; clearTimeout(firstTimer); setState(s => ({ ...s, status: 'playing', geometry: current.current.geometry, error: undefined, frames })); }
                    }
                  } finally { frame.close(); }
                }, error: error => fallback(error.message) });
                decoder.configure({ codec: message.codec, optimizeForLatency: true });
                setState(s => ({ ...s, status: 'connecting', geometry: message }));
              } else if (message.type === 'ack') {
                const at = sendTimes.current.get(message.seq); if (at !== undefined) { ackMs.current = performance.now() - at; sendTimes.current.delete(message.seq); }
                if (!sendTimes.current.size && move.current && !moveTimer.current) flushMove();
              } else if (message.type === 'fault') {
                lastFault = message.code;
                renderAllowed = false; clear(); cancel(); key = false; first = true;
                setState(s => ({ ...s, status: message.code === 'PHONE_APP_DENIED' ? 'blocked' : 'fallback', error: message.code }));
              }
              return;
            }
            const bytes = new Uint8Array(event.data); if (bytes.byteLength <= 32) return;
            const flags = bytes[0]; const header = new DataView(bytes.buffer, bytes.byteOffset, 32);
            if (flags & 1) { config = bytes.slice(32); key = false; return; }
            if (!decoder || decoder.state !== 'configured' || (!key && !(flags & 2))) return;
            if (decoder.decodeQueueSize > 8) { fallback('Phone video decoder is too slow'); return; }
            let data = bytes.subarray(32);
            if ((flags & 2) && config) { const joined = new Uint8Array(config.length + data.length); joined.set(config); joined.set(data, config.length); data = joined; }
            key = true; renderAllowed = true;
            lastFault = '';
            decoder.decode(new EncodedVideoChunk({ type: flags & 2 ? 'key' : 'delta', timestamp: Number(header.getBigUint64(12)), data }));
          } catch (error) { fallback(error instanceof Error ? error.message : 'Phone video decode failed'); }
        };
        ws.onclose = () => { if (!disposed) { cancel(); current.current.geometry = undefined; fallback(lastFault || 'Phone video disconnected; task remains paused if taken over'); } };
        ws.onerror = () => fallback('Phone video connection failed');
      } catch (error) { fallback(error instanceof Error ? error.message : 'Phone video unavailable'); }
    };
    void connect(); window.addEventListener('blur', cancel);
    return () => { disposed = true; cancel(); clearTimeout(firstTimer); clearInterval(statsTimer); window.removeEventListener('blur', cancel);
      socket.current?.close(); socket.current = null; current.current.geometry = undefined; sendTimes.current.clear(); if (decoder && decoder.state !== 'closed') decoder.close(); clear(); };
  }, [conversationId, sessionId, enabled, canvas, cancel, flushMove, attempt]);
  return { ...state, pointer, cancel, retry: () => setAttempt(value => value + 1) };
}

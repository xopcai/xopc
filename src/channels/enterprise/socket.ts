import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';


export async function postJson(url: URL | string, body: object, signal?: AbortSignal, headers?: Record<string, string>) {
  return fetchJson(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers }, signal });
}

export async function fetchJson(url: URL | string, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Provider HTTP request failed (${response.status})`);
  return response.json();
}

export type SocketConnection = {
  endpoint: string;
  authenticate?: (socket: WebSocket) => Promise<void>;
  heartbeat?: (socket: WebSocket) => Promise<void>;
  receive: (frame: unknown, socket: WebSocket) => void | Promise<void>;
};

export async function runChannelSocket(
  signal: AbortSignal,
  connect: () => Promise<SocketConnection>,
  setOnline: (socket?: WebSocket) => void,
  onFailure?: () => void,
) {
  let failures = 0;
  while (!signal.aborted) {
    let socket: WebSocket | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    const startedAt = Date.now();
    const abort = () => socket?.terminate();
    try {
      const connection = await connect();
      signal.throwIfAborted();
      const ws = new WebSocket(connection.endpoint, {
        handshakeTimeout: 10_000,
        maxPayload: 1024 * 1024,
        perMessageDeflate: false,
      });
      socket = ws;
      signal.addEventListener('abort', abort, { once: true });
      const closed = new Promise<void>((resolve) => ws.once('close', resolve));
      ws.on('error', () => ws.terminate());
      let receiving = 0;
      ws.on('message', (data) => {
        if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
        let frame: unknown;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (receiving >= 128) {
          ws.terminate();
          return;
        }
        receiving++;
        void Promise.resolve().then(() => connection.receive(frame, ws))
          .catch(() => ws.terminate()).finally(() => { receiving--; });
      });
      await Promise.race([
        once(ws, 'open', { signal }),
        closed.then(() => { throw new Error('Socket closed before opening'); }),
      ]);
      await connection.authenticate?.(ws);
      signal.throwIfAborted();
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Socket closed during authentication');
      setOnline(ws);
      let alive = true;
      ws.on('pong', () => { alive = true; });
      heartbeat = setInterval(() => {
        if (connection.heartbeat) {
          void connection.heartbeat(ws).catch(() => ws.terminate());
          return;
        }
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30_000);
      await closed;
    } catch {
      if (!signal.aborted && failures === 0) onFailure?.();
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener('abort', abort);
      socket?.terminate();
      setOnline();
    }
    if (signal.aborted) return;
    if (Date.now() - startedAt > 60_000) failures = 0;
    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    await delay(backoff + Math.random() * 250, undefined, { signal }).catch(() => undefined);
  }
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

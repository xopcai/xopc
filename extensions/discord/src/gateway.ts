import { platform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import type WebSocket from 'ws';

import { record, runChannelSocket, string } from '@xopcai/xopc/channels/enterprise/socket.js';

const intents = 1 | 512 | 4096; // Guilds, guild messages, and direct messages.
const terminalCloseCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const freshSessionCloseCodes = new Set([4007, 4009]);
export const snowflake = /^\d{17,20}$/;

function gatewayUrl(value: unknown): string {
  const url = new URL(string(value));
  if (url.protocol !== 'wss:' || url.username || url.password || url.port ||
      (url.hostname !== 'gateway.discord.gg' && !/^gateway-[a-z0-9-]+\.discord\.gg$/.test(url.hostname))) {
    throw new Error('Discord returned an invalid Gateway URL');
  }
  url.search = '?v=10&encoding=json';
  return url.href;
}

type Session = { id: string; endpoint: string; sequence: number };

export async function runDiscordGateway(options: {
  token: string;
  signal: AbortSignal;
  online: Parameters<typeof runChannelSocket>[2];
  onFailure: (message?: string) => void;
  authenticate: (signal: AbortSignal) => Promise<{ botId: string; gateway: unknown }>;
  receive: (message: Record<string, unknown>, botId: string) => Promise<void>;
}) {
  const { token, online, onFailure, authenticate, receive } = options;
  const terminal = new AbortController();
  const signal = AbortSignal.any([options.signal, terminal.signal]);
  let bot: { botId: string; gateway: unknown } | undefined;
  let session: Session | undefined;
  let dispatchTail = Promise.resolve();
  let resumeFailures = 0;
  let identifyAt = 0;
  let reconnectAt = 0;

  await runChannelSocket(signal, async () => {
    await dispatchTail.catch(() => undefined);
    dispatchTail = Promise.resolve();
    if (reconnectAt > Date.now()) await delay(reconnectAt - Date.now(), undefined, { signal });
    const identity = bot ??= await authenticate(signal);
    const resuming = session;
    const endpoint = resuming?.endpoint ?? gatewayUrl(identity.gateway);
    let connectionSession = resuming;
    let sessionInvalidated = false;
    let ready = false;
    let failed = false;
    let receivedSequence: number | null = resuming?.sequence ?? null;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let waitingForAck = false;
    let resolveReady: (() => void) | undefined;
    let hello = false;

    function heartbeat(socket: WebSocket) {
      socket.send(JSON.stringify({ op: 1, d: receivedSequence }));
      waitingForAck = true;
    }

    return {
      endpoint,
      async authenticate(socket: WebSocket) {
        socket.once('close', (code) => {
          clearTimeout(heartbeatTimer);
          if (terminalCloseCodes.has(code)) {
            onFailure(`Discord Gateway rejected this connection (${code}). Check the bot configuration.`);
            terminal.abort();
          }
          if (freshSessionCloseCodes.has(code) || (!ready && resuming && ++resumeFailures >= 3)) {
            sessionInvalidated = true;
            session = undefined;
            resumeFailures = 0;
          }
        });
        if (ready) return;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('Discord Gateway did not become ready')), 20_000);
          const closed = () => finish(new Error('Discord Gateway closed before becoming ready'));
          function finish(error?: Error) {
            clearTimeout(timer);
            socket.off('close', closed);
            resolveReady = undefined;
            if (error) reject(error);
            else resolve();
          }
          resolveReady = () => finish();
          socket.once('close', closed);
          if (socket.readyState !== socket.OPEN) closed();
        });
      },
      async receive(value: unknown, socket: WebSocket) {
        const frame = record(value);
        if (frame.op === 10) {
          const interval = Number(record(frame.d).heartbeat_interval);
          if (hello || !Number.isFinite(interval) || interval < 100 || interval > 120_000) {
            throw new Error('Invalid Discord Gateway hello');
          }
          hello = true;
          const schedule = (after: number) => {
            heartbeatTimer = setTimeout(() => {
              if (socket.readyState !== socket.OPEN) return;
              if (waitingForAck) {
                socket.terminate();
                return;
              }
              heartbeat(socket);
              schedule(interval);
            }, after);
            heartbeatTimer.unref();
          };
          schedule(interval * Math.random());
          if (resuming) {
            socket.send(JSON.stringify({ op: 6, d: { token, session_id: resuming.id, seq: resuming.sequence } }));
          } else {
            // Discord allows one identify per five seconds in a single shard's concurrency bucket.
            if (identifyAt > Date.now()) await delay(identifyAt - Date.now(), undefined, { signal });
            if (socket.readyState !== socket.OPEN) return;
            identifyAt = Date.now() + 5000;
            socket.send(JSON.stringify({ op: 2, d: { token, intents, properties: {
              os: platform(), browser: 'xopc', device: 'xopc',
            } } }));
          }
          return;
        }
        if (frame.op === 1) {
          heartbeat(socket);
          return;
        }
        if (frame.op === 11) {
          waitingForAck = false;
          return;
        }
        if (frame.op === 7 || frame.op === 9) {
          if (frame.op === 9) {
            reconnectAt = Date.now() + 1000 + Math.random() * 4000;
            if (frame.d !== true) {
              sessionInvalidated = true;
              session = undefined;
            }
          }
          socket.terminate();
          return;
        }
        if (frame.op !== 0 || !hello || !Number.isSafeInteger(frame.s) || Number(frame.s) < 0) return;
        const sequence = Number(frame.s);
        receivedSequence = sequence;

        // Commit the resume sequence only after earlier messages are admitted to xopc's durable inbox.
        dispatchTail = dispatchTail.then(async () => {
          if (signal.aborted || failed) return;
          if (frame.t === 'READY') {
            const data = record(frame.d);
            const id = string(data.session_id);
            if (!id || record(data.user).id !== identity.botId) throw new Error('Discord Gateway bot identity changed');
            connectionSession = { id, endpoint: gatewayUrl(data.resume_gateway_url), sequence };
            if (!sessionInvalidated) session = connectionSession;
            ready = true;
          } else if (connectionSession) {
            if (frame.t === 'MESSAGE_CREATE') await receive(record(frame.d), identity.botId);
            connectionSession.sequence = sequence;
            if (frame.t === 'RESUMED') ready = true;
          }
          if (ready) {
            resumeFailures = 0;
            resolveReady?.();
          }
        }).catch((error) => {
          failed = true;
          throw error;
        });
        await dispatchTail;
      },
    };
  }, online, onFailure);
}

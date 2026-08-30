#!/usr/bin/env node
import crypto from 'node:crypto';

import WebSocket from 'ws';

/**
 * Verify broker-terminated TLS for tunnel subdomains.
 *
 * Env:
 *   TUNNEL_PUBLIC_URL  e.g. https://abcd1234.frp.xopc.ai
 *   GATEWAY_TOKEN      optional Bearer for /health
 */
const publicUrl = process.env.TUNNEL_PUBLIC_URL?.trim();
if (!publicUrl) {
  console.error('Set TUNNEL_PUBLIC_URL=https://{sub}.frp.xopc.ai');
  process.exit(1);
}

const token = process.env.GATEWAY_TOKEN?.trim();
const headers = token ? { Authorization: `Bearer ${token}` } : {};

async function verifyRealtimeWebSocket(rootUrl, gatewayToken) {
  const clientId = `tunnel-verify-${crypto.randomUUID()}`;
  const ticketResponse = await fetch(`${rootUrl}/api/realtime/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify({ clientId, clientKind: 'mobile' }),
  });
  const ticketBody = await ticketResponse.json().catch(() => null);
  if (!ticketResponse.ok || !ticketBody?.payload?.ticket) {
    throw new Error(`Realtime ticket failed: ${ticketResponse.status} ${ticketResponse.statusText}`);
  }

  const wsUrl = new URL('/api/realtime/v1/ws', rootUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Realtime WebSocket verification timed out'));
    }, 10_000);
    let ready = false;
    let subscribed = false;

    const fail = (error) => {
      clearTimeout(timeout);
      socket.terminate();
      reject(error);
    };

    socket.on('open', () => {
      socket.send(JSON.stringify({
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        kind: 'realtime.hello',
        sentAt: Date.now(),
        payload: {
          ticket: ticketBody.payload.ticket,
          clientId,
          clientKind: 'mobile',
          subscriptions: [{ topic: 'gateway' }],
        },
      }));
    });
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (message.kind === 'realtime.ready') {
        ready = true;
        socket.send(JSON.stringify({
          protocolVersion: 1,
          messageId: crypto.randomUUID(),
          kind: 'realtime.ping',
          sentAt: Date.now(),
          payload: {},
        }));
      } else if (message.kind === 'realtime.subscribed') {
        subscribed = true;
      } else if (message.kind === 'realtime.pong') {
        if (!ready || !subscribed) {
          fail(new Error('Realtime WebSocket did not complete ready + subscribe handshake'));
          return;
        }
        clearTimeout(timeout);
        socket.close(1000, 'Tunnel verification complete');
        resolve();
      }
    });
    socket.on('error', (error) => fail(error));
    socket.on('close', (code, reason) => {
      if (!ready) fail(new Error(`Realtime WebSocket closed before ready (${code}: ${reason.toString()})`));
    });
  });
}

const healthUrl = `${publicUrl.replace(/\/+$/, '')}/health`;
const res = await fetch(healthUrl, { headers });
if (!res.ok) {
  console.error(`Health check failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}

console.log('Health OK:', healthUrl);

try {
  const tls = await fetch(`https://${new URL(publicUrl).hostname}`, { method: 'HEAD' });
  console.log('TLS probe status:', tls.status);
} catch (err) {
  console.warn('TLS probe skipped:', err instanceof Error ? err.message : String(err));
}

if (token) {
  await verifyRealtimeWebSocket(publicUrl.replace(/\/+$/, ''), token);
  console.log('Realtime WebSocket OK');
} else {
  console.warn('Realtime WebSocket probe skipped: set GATEWAY_TOKEN');
}

console.log('Broker TLS verification passed');

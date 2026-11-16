/** Compare local and official FRP ingress without sending a chat message. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Agent, fetch } from 'undici';

import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.js';

const count = Number(process.argv[2] ?? 12);
assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 100, 'Pass a sample count between 1 and 100');
const state = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(state, 'xopc.json'), 'utf8'));
const token = process.env.XOPC_GATEWAY_TOKEN || config.gateway?.auth?.token;
assert.ok(token, 'Gateway owner credential is required');
const local = new URL(`http://127.0.0.1:${config.gateway?.port ?? 18790}`);
const database = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
const session = database.prepare(`SELECT conversation_id AS id FROM sessions JOIN session_config USING (conversation_id)
  WHERE fixed_model = 1 AND sessions.status = 'active' AND message_count > 0
  ORDER BY last_interaction_at DESC LIMIT 1`).get();
database.close();
assert.equal(typeof session?.id, 'string', 'A materialized conversation with a fixed model is required');
const root = `/api/sessions/${encodeURIComponent(String(session!.id))}`;

function requestFor(origin: URL, dispatcher?: Agent) {
  return async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(new URL(path, origin), {
      dispatcher, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${path.replace(root, '/api/sessions/:id')} returned HTTP ${response.status}`);
    }
    return await response.json() as Record<string, any>;
  };
}

async function measurePreparation(request: ReturnType<typeof requestFor>, variant: 'serial' | 'config-only') {
  const started = performance.now();
  const history = variant === 'serial' ? await request(root + '/history?view=compact&limit=50') : undefined;
  const configStarted = performance.now();
  const config = (await request(root + '/agent-config')).payload;
  const configDone = performance.now();
  let healthMs: number | undefined;
  let contextMs: number | undefined;
  if (history) {
    await request('/api/health');
    const healthDone = performance.now();
    await request(root + '/context-summary');
    healthMs = Math.round(healthDone - configDone);
    contextMs = Math.round(performance.now() - healthDone);
    if (config.transcriptId !== undefined) assert.equal(config.transcriptId, history.session.transcriptId);
  }
  assert.equal(typeof config.configVersion, 'number');
  return {
    variant,
    preflightMs: Math.round(performance.now() - started),
    configMs: Math.round(configDone - configStarted),
    historyMs: history ? Math.round(configStarted - started) : undefined,
    healthMs,
    contextMs,
    hasTranscriptInConfig: typeof config.transcriptId === 'string',
  };
}

const origins = new Map([['loopback', local]]);
if (process.env.XOPC_LATENCY_SKIP_FRP !== '1') {
  const envelope = await requestFor(local)('/api/tunnel/status');
  const status = envelope.payload ?? envelope;
  assert.equal(status.state, 'connected', 'The local Gateway must have an active tunnel');
  const frp = new URL(status.publicUrl);
  assert.ok(frp.protocol === 'https:' && !frp.username && !frp.password && !frp.port &&
    /^[a-z0-9]{4,16}\.frp\.xopc\.ai$/.test(frp.hostname), 'Use an official xopc FRP endpoint');
  origins.set('frp', frp);
}

async function openRealtime(origin: URL, clientId: string, ticket: string) {
  const url = new URL('/api/realtime/v1/ws', origin);
  url.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const started = performance.now();
  let upgradeMs = 0;
  try {
    return await new Promise<{ upgradeMs: number; helloMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime ready timeout')), 8000);
      socket.addEventListener('open', () => {
        upgradeMs = performance.now() - started;
        socket.send(JSON.stringify({
          protocolVersion: REALTIME_PROTOCOL_VERSION, kind: 'realtime.hello',
          messageId: randomUUID(), sentAt: Date.now(),
          payload: { ticket, clientId, clientKind: 'tui', subscriptions: [] },
        }));
      }, { once: true });
      socket.addEventListener('message', (event) => {
        try {
          assert.equal(JSON.parse(String(event.data)).kind, 'realtime.ready');
          resolve({ upgradeMs, helloMs: performance.now() - started - upgradeMs });
        } catch (error) { reject(error); }
        finally { clearTimeout(timer); }
      }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Realtime closed before ready')); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Realtime upgrade failed')); }, { once: true });
    });
  } finally {
    socket.close();
  }
}

for (const [route, origin] of origins) {
  const dispatcher = new Agent({ connections: 1, allowH2: process.env.XOPC_LATENCY_HTTP2 === '1' && origin.protocol === 'https:' });
  const request = requestFor(origin, dispatcher);
  try {
    await request('/api/health');
    for (let index = 0; index < count; index++) {
      const variants = ['serial', 'config-only'] as const;
      for (const variant of index % 2 === 0 ? variants : [...variants].reverse()) {
        try {
          console.log(JSON.stringify({ route, index, ...await measurePreparation(request, variant) }));
        } catch (error) {
          console.log(JSON.stringify({ route, index, variant, failure: error instanceof Error ? error.name : 'Error' }));
          process.exitCode = 1;
        }
      }
      let stage = 'ticket';
      try {
        const started = performance.now();
        const clientId = `network-latency-${randomUUID()}`;
        const ticket = (await request('/api/realtime/tickets', { clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION })).payload.ticket;
        const ticketDone = performance.now();
        stage = 'realtime';
        const { upgradeMs, helloMs } = await openRealtime(origin, clientId, ticket);
        console.log(JSON.stringify({
          route, index, ticketMs: Math.round(ticketDone - started), upgradeMs: Math.round(upgradeMs),
          helloMs: Math.round(helloMs), ticketToReadyMs: Math.round(ticketDone - started + upgradeMs + helloMs),
        }));
      } catch (error) {
        console.log(JSON.stringify({ route, index, stage, failure: error instanceof Error ? error.name : 'Error' }));
        process.exitCode = 1;
      }
    }
  } finally {
    await dispatcher.close();
  }
}

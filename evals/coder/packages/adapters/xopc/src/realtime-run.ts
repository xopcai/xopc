import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';

export async function runRealtimeInput(input: {
  baseUrl: string;
  headers: Record<string, string>;
  sessionKey: string;
  message: string;
  thinking?: string;
  signal: AbortSignal;
  onRunId: (runId: string) => void;
  onEvent: (event: string, data: Record<string, unknown>, seq: number) => Promise<void>;
}): Promise<string> {
  const json = async (path: string, body: unknown, signal = input.signal) => {
    const response = await fetch(`${input.baseUrl}${path}`, {
      method: 'POST', headers: input.headers, body: JSON.stringify(body), signal,
    });
    if (!response.ok) throw new Error(`xopc ${path} returned HTTP ${response.status}: ${await response.text()}`);
    return await response.json() as { payload: Record<string, any> };
  };
  const principalId = randomUUID();
  const endpointId = `${principalId}:${randomUUID()}`;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = { principalId, displayName: 'Coder evaluator', kind: 'web' as const, platform: 'node' };
  await json('/api/endpoint-tools/principals', {
    ...identity, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
  });

  let resolveReady!: (origin: { endpointId: string; token: string }) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<{ endpointId: string; token: string }>((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
  });
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Either promise can fail while the other is being awaited.
  void ready.catch(() => {});
  void done.catch(() => {});
  const fail = (error: Error) => { rejectReady(error); rejectDone(error); };
  let queue = Promise.resolve();
  let runId: string | undefined;
  let completed = false;
  const clientId = `eval-${principalId}`;
  const wsUrl = new URL('/api/realtime/v1/ws', input.baseUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const client = new RealtimeClient({
    clientId, clientKind: 'web', maxReconnectAttempts: 2,
    getWebSocketUrl: () => wsUrl.href,
    createWebSocket: url => new WebSocket(url) as unknown as RealtimeWebSocket,
    issueTicket: async signal => {
      const response = await json('/api/realtime/tickets', { clientId, clientKind: 'web' }, signal);
      return response.payload.ticket;
    },
    onStateChange: (state, message) => {
      if (state === 'error') fail(new Error(message ?? 'Realtime connection failed'));
    },
    onGap: () => fail(new Error('Realtime replay gap: evaluation trace is incomplete')),
    onEvent: event => {
      if (event.topic !== `run:${runId}`) return;
      const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
      queue = queue.then(async () => {
        await input.onEvent(event.event, data, event.seq);
        if (event.event === 'run_end' || event.event === 'error') resolveDone();
      });
      void queue.catch(fail);
    },
  });
  client.setEndpoint({
    createHello: async () => {
      const hello: EndpointHelloPayload = {
        ...identity, endpointId, connectionInstanceId: randomUUID(), appVersion: '1',
        availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: [],
      };
      hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), {
        key: privateKey, dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return hello;
    },
    onReady: origin => resolveReady({ endpointId: origin.endpointId, token: origin.turnToken }),
    onMessage: () => {},
  });
  const abort = () => fail(new Error('Evaluation aborted'));
  input.signal.addEventListener('abort', abort, { once: true });
  try {
    input.signal.throwIfAborted();
    client.connect();
    const origin = await ready;
    const clientMessageId = randomUUID();
    const response = await json(`/api/sessions/${encodeURIComponent(input.sessionKey)}/inputs`, {
      clientMessageId, content: input.message, delivery: 'next', origin,
      ...(input.thinking ? { thinking: input.thinking } : {}),
    });
    const state = response.payload.state;
    const ownInput = state?.inputs?.find((row: { clientMessageId: string }) => row.clientMessageId === clientMessageId);
    runId = ownInput?.runId ?? (ownInput?.id === state?.activeInputId ? state?.activeRunId : undefined);
    if (!runId) throw new Error('Evaluation input did not start a run in its fresh session');
    input.onRunId(runId);
    client.subscribe(`run:${runId}`, 0);
    await done;
    await queue;
    completed = true;
    return runId;
  } finally {
    input.signal.removeEventListener('abort', abort);
    client.disconnect();
    if (runId && !completed) {
      await fetch(`${input.baseUrl}/api/agent/abort`, {
        method: 'POST', headers: input.headers, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    await fetch(`${input.baseUrl}/api/endpoint-tools/principals/${principalId}`, {
      method: 'DELETE', headers: input.headers, signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}

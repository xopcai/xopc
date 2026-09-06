import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';

import { XopcGatewayAdapter } from '@agent-evals/adapter-xopc';
import type { RunRequest, TraceEvent } from '@agent-evals/protocol';
import { endpointHelloSigningPayload, endpointPrincipalRegistrationSchema, endpointTurnClaimSchema } from '@xopcai/endpoint-tools-protocol';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';

async function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function fixture(mode: 'success' | 'gap' | 'pending' | 'error' = 'success') {
  const requests: Array<{ method: string; url: string; body: Record<string, any> }> = [];
  const sessionKey = 'agent:coder:webchat:default:direct:eval';
  const turnToken = 't'.repeat(40);
  let registered: Record<string, any>;
  let signatureValid = false;
  const server = createServer(async (req, res) => {
    const method = req.method ?? '';
    const url = req.url ?? '';
    const body = method === 'POST' || method === 'PATCH' ? await readJson(req) : {};
    requests.push({ method, url, body });
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/sessions' && method === 'POST') return res.end(JSON.stringify({ session: { key: sessionKey } }));
    if (url.endsWith('/agent-config')) return res.end(JSON.stringify({ payload: { model: 'test/model', thinkingLevel: 'high', effectiveWorkspacePath: '/tmp/repo' } }));
    if (url.startsWith('/api/eval/runtime-identity')) return res.end(JSON.stringify({ payload: { manifestHash: 'manifest' } }));
    if (url === '/api/endpoint-tools/principals' && method === 'POST') {
      registered = endpointPrincipalRegistrationSchema.parse(body);
      return res.end('{"ok":true}');
    }
    if (url === '/api/realtime/tickets') return res.end(JSON.stringify({ payload: { ticket: 'x'.repeat(40) } }));
    if (url.endsWith('/inputs')) {
      if (!signatureValid || !endpointTurnClaimSchema.safeParse(body.origin).success || body.origin?.token !== turnToken) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify({ payload: { state: { activeRunId: 'xopc-run', activeInputId: 'input', inputs: [{ id: 'input', clientMessageId: body.clientMessageId, runId: 'xopc-run' }] } } }));
    }
    if (method === 'DELETE' || url === '/api/agent/abort') return res.end('{"ok":true}');
    res.statusCode = 404;
    res.end('{"error":"Not found"}');
  });
  const sockets = new WebSocketServer({ server, path: '/api/realtime/v1/ws' });
  sockets.on('connection', socket => {
    const send = (kind: string, payload: unknown) => socket.send(JSON.stringify({ protocolVersion: 1, messageId: randomUUID(), sentAt: Date.now(), kind, payload }));
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      if (frame.kind === 'realtime.hello') {
        const hello = frame.payload.endpoint;
        signatureValid = verify('sha256', Buffer.from(endpointHelloSigningPayload(hello)), {
          key: createPublicKey({ key: Buffer.from(registered.publicKey, 'base64url'), type: 'spki', format: 'der' }), dsaEncoding: 'ieee-p1363',
        }, Buffer.from(hello.signature, 'base64url'));
        send('realtime.ready', { connectionId: randomUUID(), heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000, endpoint: { endpointId: hello.endpointId, turnToken } });
      }
      if (frame.kind === 'realtime.subscribe') {
        const subscription = frame.payload.subscriptions[0];
        expect(subscription).toEqual({ topic: 'run:xopc-run', afterSeq: 0 });
        if (mode === 'pending') return;
        if (mode === 'gap') return send('realtime.gap', { topic: subscription.topic, requestedSeq: 0, earliestSeq: 10, recoverable: false });
        const events = mode === 'error' ? [['error', { message: 'provider rejected' }]] : [
          ['run_start', {}], ['assistant_message_start', {}], ['assistant_delta', { delta: 'done' }],
          ['assistant_message_end', { usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }], ['run_end', { status: 'success' }],
        ];
        events.forEach(([event, payload], index) => {
          const data = { topic: subscription.topic, seq: index + 1, event, data: { type: event, runId: 'xopc-run', payload } };
          send('realtime.event', data);
          if (index === 2) send('realtime.event', data); // Replay duplicates must not duplicate text or usage.
        });
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const request: RunRequest = {
    runId: 'eval-run', experimentId: 'experiment',
    evalCase: { id: 'case', repo: { source: 'local', path: '/tmp/repo', commit: 'HEAD' }, task: 'Make the change', budget: { timeoutMs: 10000 }, graders: [], tags: [] },
    variant: { id: 'candidate', adapter: 'xopc', model: 'test/model', reasoning: 'high', config: { baseUrl: `http://127.0.0.1:${address.port}` } },
    environment: { workspace: '/tmp/repo', sourceCommit: 'head', fixtureCommit: 'fixture', metadata: {} },
  };
  return { request, requests, sessionKey, close: async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

it('submits signed session input and captures ordered realtime replay without duplicate text', async () => {
  const f = await fixture();
  const adapter = new XopcGatewayAdapter();
  const events: TraceEvent[] = [];
  try {
    const result = await adapter.run(f.request, async event => { await new Promise(resolve => setTimeout(resolve, 2)); events.push(event); }, new AbortController().signal);
    await adapter.cleanup(f.request.runId);
    expect(result).toMatchObject({ status: 'completed', finalText: 'done', agentRunId: 'xopc-run', usage: { input: 5, output: 2 }, runtimeIdentity: { effectiveModelRef: 'test/model', manifestHash: 'manifest' } });
    expect(events.map(event => event.type)).toEqual(['agent.event', 'run.started', 'model.request', 'agent.event', 'model.response', 'run.completed']);
    expect(f.requests.find(r => r.url.endsWith('/inputs'))?.body).toMatchObject({ content: 'Make the change', delivery: 'next', thinking: 'high', origin: { token: 't'.repeat(40) } });
    expect(f.requests.some(r => r.url === '/api/agent')).toBe(false);
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(2);
  } finally { await f.close(); }
});

it.each(['gap', 'error'] as const)('does not report success after a realtime %s', async mode => {
  const f = await fixture(mode);
  const adapter = new XopcGatewayAdapter();
  try {
    const result = adapter.run(f.request, () => {}, new AbortController().signal);
    if (mode === 'gap') await expect(result).rejects.toThrow('trace is incomplete');
    else expect(await result).toMatchObject({ status: 'failed', error: 'provider rejected' });
  } finally { await adapter.cleanup(f.request.runId); await f.close(); }
});

it('aborts the active server run and closes realtime on cancellation', async () => {
  const f = await fixture('pending');
  const adapter = new XopcGatewayAdapter();
  const controller = new AbortController();
  try {
    const result = adapter.run(f.request, () => {}, controller.signal);
    void result.catch(() => {});
    await expect.poll(() => f.requests.some(r => r.url.endsWith('/inputs'))).toBe(true);
    await adapter.abort(f.request.runId);
    controller.abort();
    await expect(result).rejects.toThrow('aborted');
    expect(f.requests.find(r => r.url === '/api/agent/abort')?.body).toEqual({ runId: 'xopc-run' });
  } finally { await adapter.cleanup(f.request.runId); await f.close(); }
});

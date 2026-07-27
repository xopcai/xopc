import { createServer } from 'node:http';

import { XopcGatewayAdapter, parseSseStream } from '@agent-evals/adapter-xopc';
import type { RunRequest, TraceEvent } from '@agent-evals/protocol';
import { describe, expect, it } from 'vitest';

async function readJson(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

describe('parseSseStream', () => {
  it('parses chunked CRLF events and multiline data', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'id: 1\r\nevent: run_start\r\ndata: {"type":"run_start"}\r\n\r\n',
      'event: message\ndata: first\ndata: second\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event);

    expect(events).toEqual([
      { id: '1', event: 'run_start', data: '{"type":"run_start"}' },
      { event: 'message', data: 'first\nsecond' },
    ]);
  });

  it('runs against the public xopc SSE contract and normalizes events', async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    const sessionKey = 'agent:coder:webchat:default:direct:eval_eval-run';
    const server = createServer(async (request, response) => {
      const method = request.method ?? '';
      const url = request.url ?? '';
      if (method === 'POST' && url === '/api/sessions') {
        const body = await readJson(request);
        requests.push({ method, url, body });
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ session: { key: sessionKey } }));
        return;
      }
      if (
        method === 'PATCH' &&
        url === `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`
      ) {
        const body = await readJson(request);
        requests.push({ method, url, body });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      if (method === 'GET' && url === '/api/eval/runtime-identity?agentId=coder') {
        requests.push({ method, url });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          payload: {
            schemaVersion: 1,
            agentId: 'coder',
            modelRef: 'test/model',
            manifestHash: 'manifest',
          },
        }));
        return;
      }
      if (method === 'POST' && url === '/api/agent') {
        const body = await readJson(request);
        requests.push({ method, url, body });
        expect(request.headers.accept).toBe('text/event-stream');
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('event: run_start\ndata: {"type":"run_start","runId":"xopc-run","payload":{}}\n\n');
        response.write('event: assistant_delta\ndata: {"type":"assistant_delta","runId":"xopc-run","payload":{"delta":"done"}}\n\n');
        response.end('event: run_end\ndata: {"type":"run_end","runId":"xopc-run","payload":{}}\n\n');
        return;
      }
      if (method === 'DELETE' && url === `/api/sessions/${encodeURIComponent(sessionKey)}`) {
        requests.push({ method, url });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const request: RunRequest = {
      runId: 'eval-run',
      experimentId: 'experiment',
      evalCase: {
        id: 'case',
        repo: { source: 'local', path: '/tmp/repo', commit: 'HEAD' },
        task: 'Make the change',
        budget: { timeoutMs: 10_000 },
        graders: [{ type: 'command', command: 'true' }],
        tags: [],
      },
      variant: {
        id: 'xopc',
        adapter: 'xopc',
        agentId: 'coder',
        model: 'test/model',
        reasoning: 'high',
        config: {
          baseUrl: `http://127.0.0.1:${address.port}`,
          thinking: 'medium',
        },
      },
      environment: {
        workspace: '/tmp/repo',
        sourceCommit: 'head',
        fixtureCommit: 'fixture',
        metadata: {},
      },
    };
    const events: TraceEvent[] = [];

    try {
      const adapter = new XopcGatewayAdapter();
      const result = await adapter.run(
        request,
        (event) => { events.push(event); },
        new AbortController().signal,
      );
      await adapter.cleanup(request.runId);

      expect(result).toMatchObject({
        status: 'completed',
        finalText: 'done',
        agentRunId: 'xopc-run',
        sessionKey,
        runtimeIdentity: {
          schemaVersion: 1,
          agentId: 'coder',
          modelRef: 'test/model',
          manifestHash: 'manifest',
        },
      });
      expect(requests).toEqual([
        {
          method: 'POST',
          url: '/api/sessions',
          body: { channel: 'webchat', agentId: 'coder', chat_id: 'eval_eval-run' },
        },
        {
          method: 'PATCH',
          url: `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
          body: {
            workingDirectory: '/tmp/repo',
            model: 'test/model',
            thinkingLevel: 'medium',
            reasoningLevel: 'high',
          },
        },
        {
          method: 'GET',
          url: '/api/eval/runtime-identity?agentId=coder',
        },
        {
          method: 'POST',
          url: '/api/agent',
          body: expect.objectContaining({
            sessionKey,
            message: 'Make the change',
            thinking: 'medium',
          }),
        },
        { method: 'DELETE', url: `/api/sessions/${encodeURIComponent(sessionKey)}` },
      ]);
      expect(events.map((event) => event.type)).toEqual([
        'agent.event',
        'run.started',
        'model.response',
        'run.completed',
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

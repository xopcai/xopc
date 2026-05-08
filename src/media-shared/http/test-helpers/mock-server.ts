/**
 * In-process HTTP mock server for voice / media-understanding tests.
 *
 * DECISION (per docs/voice-rearchitecture.md §14):
 *  - Tests must NOT hit real provider endpoints. We spin up an ephemeral HTTP
 *    server (random port on 127.0.0.1) and assert request/response shapes.
 *  - SSRF tests intentionally bind to 127.0.0.1 (private). Tests that exercise
 *    the SSRF guard pass `allowPrivateNetwork: true` to the production code.
 *  - This helper is import-only from `__tests__/` files — never from runtime
 *    code. Kept under the runtime tree (not test/) so vitest picks it up via
 *    the existing co-located test discovery.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  /** Response body as string, Buffer, or async iterable for streaming. */
  body?: string | Buffer | AsyncIterable<Uint8Array>;
  /** Artificial delay before sending headers (ms). Useful for timeout tests. */
  delayMs?: number;
}

export interface MockRequestRecord {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  receivedAt: number;
}

export type MockHandler = (
  req: IncomingMessage,
  bodyBuffer: Buffer,
) => Promise<MockResponseSpec> | MockResponseSpec;

export interface MockServerHandle {
  /** Base URL like http://127.0.0.1:51234 (no trailing slash). */
  baseUrl: string;
  /** Recorded requests in receive order. */
  requests: MockRequestRecord[];
  /** Stop the server. Idempotent. */
  close(): Promise<void>;
  /** Replace the handler at runtime (e.g. flip from 401 → 200 in rotation tests). */
  setHandler(handler: MockHandler): void;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(res: ServerResponse, spec: MockResponseSpec): Promise<void> {
  if (spec.delayMs && spec.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
  }
  const status = spec.status ?? 200;
  const headers = spec.headers ?? {};
  res.writeHead(status, headers);

  const body = spec.body;
  if (body === undefined) {
    res.end();
    return;
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  // AsyncIterable<Uint8Array> — stream chunks.
  for await (const chunk of body) {
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

/**
 * Start an HTTP mock server bound to 127.0.0.1 on an ephemeral port. The
 * returned handle exposes the base URL, recorded requests, and a `close()`
 * method tests should call in `afterEach` / `afterAll`.
 */
export async function startMockServer(initialHandler: MockHandler): Promise<MockServerHandle> {
  const requests: MockRequestRecord[] = [];
  let activeHandler: MockHandler = initialHandler;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readRequestBody(req);
      requests.push({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        receivedAt: Date.now(),
      });
      try {
        const spec = await activeHandler(req, body);
        await writeResponse(res, spec);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    requests,
    setHandler(next) {
      activeHandler = next;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

/**
 * Convenience builder: cycle through a fixed sequence of responses (used by
 * key-rotation tests where call N gets 401 and call N+1 gets 200).
 */
export function cycleHandlers(specs: readonly MockResponseSpec[]): MockHandler {
  let index = 0;
  return () => {
    const spec = specs[Math.min(index, specs.length - 1)];
    index += 1;
    return spec;
  };
}

import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendModelContext } from './question-context.mjs';

/** Evaluation-only HTTP boundary: each physical model request holds one shared lease. */
export function installRequestProtocol(input: {
  out: string; expectedModel: string; pool: 'generation' | 'judge'; caseId: string;
  phase?: () => string; modelContext?: () => string | undefined; fetch?: typeof globalThis.fetch;
}) {
  const transport = input.fetch ?? globalThis.fetch;
  const endpoint = process.env.XOPC_STYLE_POOL_URL;
  const token = process.env.XOPC_STYLE_POOL_TOKEN;
  if (!endpoint) throw new Error('Physical request protocol requires a shared pool');
  const modelId = input.expectedModel.split('/').at(-1)!;
  const log = (event: unknown) => appendFileSync(join(input.out, 'model-requests.jsonl'), JSON.stringify(event)+'\n');
  const poolRequest = async (path: string, body: unknown) => {
    const response = await transport(endpoint+path, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3_600_000) });
    if (!response.ok) throw new Error(`Pool ${path} HTTP ${response.status}`);
    return response.json() as Promise<any>;
  };
  const pending = new Set<Promise<void>>();
  const active = new Map<string, { abort: AbortController; release: (error?: string | null) => Promise<void> }>();
  const wrapped: typeof globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    const method = options?.method ?? (resource instanceof Request ? resource.method : 'GET');
    if (method.toUpperCase() !== 'POST' || !/\/(responses(?:\/compact)?|chat\/completions|messages)\/?$/.test(url.pathname)) {
      return transport(resource, options);
    }
    const originalBody = typeof options?.body === 'string' ? options.body
      : resource instanceof Request ? await resource.clone().text() : '';
    const payload = JSON.parse(originalBody);
    const context = input.modelContext?.();
    if (context) appendModelContext(payload, url.pathname, context);
    const body = context ? JSON.stringify(payload) : originalBody;
    const actualModel = String(payload.model ?? '');
    const id = randomUUID(), phase = input.phase?.() ?? 'judge';
    if (actualModel.split('/').at(-1) !== modelId) {
      log({ event: 'blocked', id, caseId: input.caseId, model: actualModel, expected: modelId, phase });
      throw new Error(`Memory protocol blocked unexpected model: ${actualModel}`);
    }
    const { lease } = await poolRequest('/acquire', { pool: input.pool,
      context: { caseId: input.caseId, phase, requestId: id, model: actualModel, variant: process.env.XOPC_MEMORY_VARIANT, physicalRequest: true } });
    log({ event: 'start', id, lease, phase, model: actualModel, at: Date.now(),
      payloadHash: createHash('sha256').update(body).digest('hex'), reasoning: payload.reasoning ?? null });
    if (phase !== 'learning' && input.pool === 'generation') {
      const dir = join(input.out, 'model-inputs'); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, id+'.json'), JSON.stringify({ phase, payload }));
    }
    let released = false;
    const release = async (error: string | null = null) => {
      if (released) return;
      released = true;
      active.delete(id);
      log({ event: 'end', id, lease, phase, model: actualModel, at: Date.now(), error });
      const done = poolRequest('/release', { lease, error }).then(() => {});
      pending.add(done); try { await done; } finally { pending.delete(done); }
    };
    const callerSignal = options?.signal ?? (resource instanceof Request ? resource.signal : undefined);
    const abort = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal, abort.signal]) : abort.signal;
    active.set(id, { abort, release });
    const aborted = () => { void release('Request aborted').catch(() => {}); };
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      const response = await transport(resource, { ...options, ...(context ? { body } : {}), signal });
      if (!response.body || !response.ok) {
        signal?.removeEventListener('abort', aborted);
        await release(response.ok ? null : `HTTP ${response.status}`);
        return response;
      }
      const reader = response.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { signal?.removeEventListener('abort', aborted); await release(); controller.close(); }
            else controller.enqueue(next.value);
          } catch (error) { signal?.removeEventListener('abort', aborted); await release(String(error)); controller.error(error); }
        },
        async cancel(reason) { signal?.removeEventListener('abort', aborted); try { await reader.cancel(reason); } finally { await release('Response canceled'); } },
      });
      const projected = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(projected, 'url', { value: response.url });
      return projected;
    } catch (error) { signal?.removeEventListener('abort', aborted); await release(String(error)); throw error; }
  };
  globalThis.fetch = wrapped;
  return { async close() { for (const request of active.values()) request.abort.abort(); await Promise.all([...active.values()].map(request => request.release('Protocol shutdown'))); await Promise.all([...pending]); if (globalThis.fetch === wrapped) globalThis.fetch = transport; } };
}

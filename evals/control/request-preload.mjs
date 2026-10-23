import { appendFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { usageObserver } from './wire-usage.mjs';
// Opt-in fetch instrumentation in isolated evaluation child processes only.
const endpoint = process.env.XOPC_EVAL_POOL_URL;
const token = process.env.XOPC_EVAL_POOL_TOKEN;
const defaultRole = process.env.XOPC_EVAL_POOL_ROLE ?? 'generation';
const origins = new Set(JSON.parse(process.env.XOPC_EVAL_MODEL_ORIGINS ?? '[]'));
if (endpoint && token && origins.size) {
  const original = globalThis.fetch;
  const rpc = async (path, body, signal) => {
    const response = await original(endpoint + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`Evaluation request pool: ${response.status}`);
    return response.json();
  };
  const active = new Map();
  process.on('exit', () => {
    for (const finish of active.values()) finish('process_exit');
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const modelPath = /\/(responses(?:\/compact)?|chat\/completions|messages)\/?$/.test(url.pathname);
    if (!origins.has(url.origin)) {
      if (modelPath) throw new Error('Evaluation blocked undeclared model origin');
      return original(input, init);
    }
    if (!modelPath) return original(input, init);
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    let payload; try { payload = JSON.parse(raw); } catch { throw new Error('Model request body is not auditable JSON'); }
    const requestId = randomUUID();
    const context = init?.[Symbol.for('xopc.modelRequestContext')];
    const role = /judge|review|acceptance/.test(context?.operation ?? '') ? 'judge' : defaultRole;
    const audit = event => { if (process.env.XOPC_EVAL_AUDIT_PATH) appendFileSync(process.env.XOPC_EVAL_AUDIT_PATH, JSON.stringify({ ...event, requestId, pid: process.pid, at: new Date().toISOString() }) + '\n', { mode: 0o600 }); };
    const observer = usageObserver();
    let status = null, cloudRequestId = null;

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const { lease } = await rpc('/acquire', { pool: role, context: { pid: process.pid, origin: url.origin, requestId } }, signal);
    audit({ event: 'start', lease, usageEventId: context?.id ?? null, operation: context?.operation ?? null, poolRole: role, model: payload.model, origin: url.origin, path: url.pathname, payloadHash: createHash('sha256').update(raw).digest('hex') });
    let released = false;
    const finish = (error = null) => {
      if (released) return false;
      released = true; active.delete(requestId);
      audit({ event: 'end', lease, status, cloudRequestId, error, terminalState: error ? 'interrupted' : 'eof', ...observer.finish() });
      return true;
    };
    active.set(requestId, finish);
    const release = async (overloaded, error = null) => { if (finish(error)) await rpc('/release', { lease, overloaded }); };
    try {
      const response = await original(input, init);
      status = response.status;
      cloudRequestId = response.headers.get('x-xopc-request-id');
      if (!response.body) { await release(response.status === 429 || response.status === 503); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { await release(response.status === 429 || response.status === 503); controller.close(); }
            else { observer.push(next.value); controller.enqueue(next.value); }
          } catch (error) { await release(false, String(error)); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { await release(false, 'Response canceled'); } },
      });
      return new Response(body, { headers: response.headers, status: response.status, statusText: response.statusText });
    } catch (error) { await release(false, String(error)); throw error; }
  };
}

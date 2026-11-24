import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream, type SimpleStreamOptions } from '@earendil-works/pi-ai/compat';

import { captureCloudUsageResponse, currentUsageRequestContext } from './cloud-receipts.js';

type CloudUsageReport = {
  authoritative: boolean;
  totalInputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  resolvedModel?: string;
};

const reports = new WeakMap<AssistantMessage, CloudUsageReport>();
export function getCloudUsageReport(message: AssistantMessage): CloudUsageReport | undefined {
  return reports.get(message);
}

/** Preserve authoritative Cloud totals when an OpenAI-compatible SDK recomputes them. */
export function cloudWireUsage(options: SimpleStreamOptions = {}) {
  const transport = options.fetch ?? globalThis.fetch;
  let total: number | undefined;
  let totalInputTokens: number | undefined;
  let resolvedModel: string | undefined;
  let components: Partial<AssistantMessage['usage']> = {};
  let tail: Promise<void> = Promise.resolve();
  const apply = (message: AssistantMessage) => {
    reports.set(message, { authoritative: total !== undefined, totalInputTokens,
      cacheRead: components.cacheRead, cacheWrite: components.cacheWrite, resolvedModel });
    if (total !== undefined) message.usage = { ...message.usage, ...components, totalTokens: total };
    return message;
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    total = undefined; totalInputTokens = undefined; resolvedModel = undefined; components = {};
    // Keep the physical stream alive briefly after caller cancellation to collect final usage.
    // Caller cancellation still reaches the SDK; no generated result can continue execution.
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleaned = false;
    const onAbort = () => { if (cleaned) return; timer ??= setTimeout(() => controller.abort(callerSignal?.reason), 15_000); };
    const cleanup = () => { cleaned = true; if (timer) clearTimeout(timer); callerSignal?.removeEventListener('abort', onAbort); };
    if (callerSignal?.aborted) throw callerSignal.reason;
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    let response: Response;
    try {
      response = await transport(input, Object.assign({}, init, { signal: controller.signal,
        [Symbol.for('xopc.modelRequestContext')]: currentUsageRequestContext() }));
    } catch (error) { cleanup(); throw error; }
    captureCloudUsageResponse(response);
    if (!response.ok || !response.body) { cleanup(); return response; }
    const routedModel = response.headers.get('x-xopc-resolved-model');
    if (routedModel && /^[a-z0-9_./:-]{1,160}$/i.test(routedModel)) resolvedModel = routedModel;
    const jsonResponse = response.headers.get('content-type')?.includes('application/json');
    const decoder = new TextDecoder(); let buffer = '';
    const consume = (line: string) => {
      const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      try {
        const value = JSON.parse(raw);
        const usage = (value.response ?? value).usage;
        const n = usage?.total_tokens;
        if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) {
          total = n;
          const number = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
          const input = usage.prompt_tokens ?? usage.input_tokens;
          const output = usage.completion_tokens ?? usage.output_tokens;
          const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens
            ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens;
          const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens ?? usage.input_tokens_details?.cache_write_tokens;
          const uncached = usage.prompt_tokens_details?.uncached_tokens ?? usage.input_tokens_details?.uncached_tokens;
          const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens;
          if (number(input) && (number(uncached) || number(output) && input + output === n)) totalInputTokens = input;
          components = {
            ...(number(uncached) ? { input: uncached } : number(input)
              ? { input: Math.max(0, input - (number(cacheRead) ? cacheRead : 0) - (number(cacheWrite) ? cacheWrite : 0)) } : {}),
            ...(number(output) ? { output } : {}), ...(number(cacheRead) ? { cacheRead } : {}),
            ...(number(cacheWrite) ? { cacheWrite } : {}), ...(number(reasoning) ? { reasoning } : {}),
          };
        }
      } catch { /* Non-data SSE fields and deltas carry no authoritative total. */ }
    };
    const reader = response.body.getReader();
    let completeTail!: () => void;
    tail = new Promise<void>(resolve => { completeTail = resolve; });
    let ended = false;
    let canceled = false;
    const finish = () => {
      if (ended) return;
      ended = true; buffer += decoder.decode(); consume(buffer); cleanup(); completeTail();
    };
    const observe = (chunk: Uint8Array) => {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while (!jsonResponse && (end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (buffer.length > 2_000_000) buffer = '';
    };
    const projected = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          const next = await reader.read();
          if (next.done) { finish(); if (!canceled) destination.close(); }
          else { observe(next.value); if (!canceled) destination.enqueue(next.value); }
        } catch (error) { finish(); if (!canceled) destination.error(error); }
      },
      async cancel() {
        canceled = true;
        onAbort();
        try {
          while (!ended) { const next = await reader.read(); if (next.done) break; observe(next.value); }
        } catch { /* A bounded drain without final usage remains unknown. */ }
        finally { finish(); }
      },
    });
    const result = new Response(projected, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(result, 'url', { value: response.url });
    return result;
  };
  return {
    options: { ...options, fetch: fetchImpl }, apply,
    settle: () => tail,
    wrap(source: AssistantMessageEventStream): AssistantMessageEventStream {
      const projected = createAssistantMessageEventStream();
      const completion = source.result().then(async message => { await tail; return apply(message); });
      void completion.catch(() => {});
      projected.result = () => completion;
      void (async () => {
        try {
          for await (const event of source) {
            if (event.type === 'done') { await tail; apply(event.message); }
            else if (event.type === 'error') { await tail; apply(event.error); }
            projected.push(event);
          }
          projected.end();
        } catch { projected.end(); }
      })();
      return projected;
    },
  };
}

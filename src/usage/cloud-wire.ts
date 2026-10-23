import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream, type SimpleStreamOptions } from '@earendil-works/pi-ai/compat';

import { captureCloudUsageResponse, currentUsageRequestContext } from './cloud-receipts.js';

/** Preserve authoritative Cloud totals when an OpenAI-compatible SDK recomputes them. */
export function cloudWireUsage(options: SimpleStreamOptions = {}) {
  const transport = options.fetch ?? globalThis.fetch;
  let total: number | undefined;
  const apply = (message: AssistantMessage) => {
    if (total !== undefined) message.usage = { ...message.usage, totalTokens: total };
    return message;
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    total = undefined;
    const response = await transport(input, Object.assign({}, init, { [Symbol.for('xopc.modelRequestContext')]: currentUsageRequestContext() }));
    captureCloudUsageResponse(response);
    if (!response.ok || !response.body) return response;
    const decoder = new TextDecoder(); let buffer = '';
    const consume = (line: string) => {
      const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      try {
        const value = JSON.parse(raw) as { usage?: { total_tokens?: unknown }; response?: { usage?: { total_tokens?: unknown } } };
        const n = (value.response ?? value).usage?.total_tokens;
        if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) total = n;
      } catch { /* Non-data SSE fields and deltas carry no authoritative total. */ }
    };
    const projected = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
        if (buffer.length > 2_000_000) buffer = '';
        controller.enqueue(chunk);
      },
      flush() { buffer += decoder.decode(); consume(buffer); },
    }));
    const result = new Response(projected, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(result, 'url', { value: response.url });
    return result;
  };
  return {
    options: { ...options, fetch: fetchImpl }, apply,
    wrap(source: AssistantMessageEventStream): AssistantMessageEventStream {
      const projected = createAssistantMessageEventStream();
      const completion = source.result().then(apply);
      void completion.catch(() => {});
      projected.result = () => completion;
      void (async () => {
        try {
          for await (const event of source) {
            if (event.type === 'done') apply(event.message);
            else if (event.type === 'error') apply(event.error);
            projected.push(event);
          }
          projected.end();
        } catch { projected.end(); }
      })();
      return projected;
    },
  };
}

import { performance } from 'node:perf_hooks';

import { PhoneError } from './contracts.js';
import type { PhoneModelMetric } from './execution-trace.js';

function usage(value: unknown, metric: PhoneModelMetric): void {
  if (!value || typeof value !== 'object') return;
  for (const [source, target] of [['prompt_tokens', 'promptTokens'], ['completion_tokens', 'completionTokens'], ['total_tokens', 'totalTokens']] as const) {
    const count = value[source];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) metric[target] = count;
  }
}

/** Require substantial exact repetition; ordinary short repeated labels do not trigger it. */
export function repeatedPhoneOutput(text: string): boolean {
  if (text.length < 1200) return false;
  const tail = text.slice(-12000).trim();
  for (let size = 100; size <= Math.min(1500, Math.floor(tail.length / 4)); size++) {
    const unit = tail.slice(-size);
    if (tail.endsWith(unit.repeat(4))) return true;
  }
  return false;
}

/** Read complete decisions only. Streaming chunks are never executable actions. */
export async function readPhoneModelResponse(response: Response, metric: PhoneModelMetric, started: number, repetitionGuard = false): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned an empty response');
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  const decoder = new TextDecoder();
  let bytes = 0; let pending = ''; let content = ''; let finish: string | null = null; let done = false; let checkedAt = 0;
  const event = (raw: string) => {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    if (done) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model sent data after stream completion');
    let value: any;
    try { value = JSON.parse(data); } catch { throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned invalid stream data'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned invalid stream data');
    if (value.error) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model stream reported an error');
    usage(value.usage, metric);
    const choice = (Array.isArray(value.choices) ? value.choices : []).find((item: any) => (item.index ?? 0) === 0);
    if (!choice) return;
    const token = choice.delta?.content;
    if (choice.delta?.reasoning_content || token) metric.firstTokenMs ??= Math.round(performance.now() - started);
    if (typeof token === 'string' && token.length) {
      if (finish) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model sent content after its final decision');
      metric.firstTokenMs ??= Math.round(performance.now() - started);
      content += token;
      if (content.length > 64000) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model output exceeds limit');
      if (repetitionGuard && content.length - checkedAt >= 256) {
        checkedAt = content.length;
        if (repeatedPhoneOutput(content)) throw new PhoneError('PHONE_MODEL_REPETITION', 'Phone model repeated its output without completing a decision; no action was dispatched');
      }
    }
    if (choice.finish_reason) { finish = String(choice.finish_reason); metric.finishReason = finish.slice(0, 80); }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.length) metric.firstByteMs ??= Math.round(performance.now() - started);
      bytes += next.value.length; metric.responseBytes = bytes;
      if (bytes > (streaming ? 2 * 1024 * 1024 : 256 * 1024)) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model response exceeds limit');
      pending += decoder.decode(next.value, { stream: true });
      if (streaming) {
        pending = pending.replaceAll('\r\n', '\n');
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) >= 0) { event(pending.slice(0, boundary)); pending = pending.slice(boundary + 2); }
        if (pending.length > 256 * 1024) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model stream event exceeds limit');
      }
    }
    pending += decoder.decode();
    if (streaming) {
      if (pending.trim()) event(pending);
      if (!done || !finish) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model stream ended without a completed decision');
      return { choices: [{ message: { content }, finish_reason: finish }] };
    }
    let value: any;
    try { value = JSON.parse(pending); } catch { throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned invalid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Phone model returned invalid JSON');
    usage(value.usage, metric);
    const reason = value.choices?.[0]?.finish_reason;
    if (typeof reason === 'string') metric.finishReason = reason.slice(0, 80);
    return value;
  } finally { await reader.cancel().catch(() => {}); }
}

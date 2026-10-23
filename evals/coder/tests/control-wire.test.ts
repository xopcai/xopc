import { describe, expect, it } from 'vitest';
// @ts-expect-error Evaluation preload is a standalone native ESM module.
import { usageObserver } from '../../control/wire-usage.mjs';

describe('physical response usage', () => {
  it('keeps terminal usage once across arbitrarily split SSE chunks', () => {
    const observer = usageObserver();
    const bytes = new TextEncoder().encode('data: {"id":"r1","model":"fixed","usage":{"prompt_tokens":100,"completion_tokens":25,"total_tokens":125,"prompt_tokens_details":{"cached_tokens":80}}}\n\ndata: [DONE]\n\n');
    for (const byte of bytes) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ responseId: 'r1', responseModel: 'fixed', usage: {input:100, output:25, total:125, cacheRead:80}, overflow:false });
  });
  it('preserves unknown usage for incomplete responses and parses Responses JSON', () => {
    const incomplete = usageObserver(); incomplete.push(new TextEncoder().encode('data: {"choices":[]}\n\n'));
    expect(incomplete.finish().usage).toBeNull();
    const json = usageObserver(); json.push(new TextEncoder().encode('{"id":"r2","usage":{"input_tokens":12,"output_tokens":3}}'));
    expect(json.finish().usage).toMatchObject({ input:12, output:3, total:15 });
  });
});

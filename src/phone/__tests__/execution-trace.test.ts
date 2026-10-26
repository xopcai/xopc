import { describe, expect, it } from 'vitest';
import { PhoneExecutionTrace, currentPhoneTrace, measurePhonePhase } from '../execution-trace.js';
import { readPhoneModelResponse, repeatedPhoneOutput } from '../model-response.js';

function stream(events: string[], options = { fragmented: false }) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${event}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    if (options.fragmented) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const chunk = (content: string) => JSON.stringify({ choices: [{ index: 0, delta: { content } }] });
const stop = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

describe('phone numeric execution diagnostics', () => {
  it('isolates concurrent traces, counts failures, bounds model calls and clones snapshots', async () => {
    const first = new PhoneExecutionTrace(); const second = new PhoneExecutionTrace();
    await Promise.all([
      first.run(async () => {
        await expect(measurePhonePhase('hierarchy', async () => { throw new Error('screen-secret'); })).rejects.toThrow();
        for (let i = 0; i < 130; i++) currentPhoneTrace()!.model({ completionTokens: i });
      }),
      second.run(() => measurePhonePhase('screenshot', async () => {})),
    ]);
    expect(first.snapshot()).toMatchObject({ phases: { hierarchy: { count: 1, errors: 1 } }, droppedModelCalls: 10 });
    expect(first.snapshot().modelCalls).toHaveLength(120);
    expect(second.snapshot().phases.hierarchy).toBeUndefined();
    expect(JSON.stringify(first.snapshot())).not.toContain('screen-secret');
    const snapshot = first.snapshot(); snapshot.modelCalls[0].completionTokens = -1;
    expect(first.snapshot().modelCalls[0].completionTokens).toBe(10);
    expect(currentPhoneTrace()).toBeUndefined();
  });
});

describe('complete streamed phone decisions', () => {
  it('handles fragmented UTF-8 and CRLF while retaining numeric usage', async () => {
    const metric = {};
    const response = await readPhoneModelResponse(stream([chunk('finish(message="咖啡")'), stop, '[DONE]'], { fragmented: true }), metric, performance.now());
    expect(response).toMatchObject({ choices: [{ message: { content: 'finish(message="咖啡")' }, finish_reason: 'stop' }] });
    expect(metric).toMatchObject({ promptTokens: 10, completionTokens: 20, totalTokens: 30, firstTokenMs: expect.any(Number) });
  });
  it('refuses a plausible action when the stream is incomplete or reports an error', async () => {
    for (const events of [[chunk('do(action="Back")')], [chunk('do(action="Back")'), stop], [JSON.stringify({ error: { message: 'sensitive' } })]])
      await expect(readPhoneModelResponse(stream(events), {}, performance.now())).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
  });
  it('stops pathological repetitions before receiving a final action', async () => {
    const repeated = 'This is one long repeated model sentence with no actionable progress. '.repeat(30);
    expect(repeatedPhoneOutput(repeated)).toBe(true);
    expect(repeatedPhoneOutput('Coffee Coffee Coffee')).toBe(false);
    await expect(readPhoneModelResponse(stream([chunk(repeated), stop, '[DONE]']), {}, performance.now(), true))
      .rejects.toMatchObject({ code: 'PHONE_MODEL_REPETITION' });
  });
  it('labels JSON first-byte time separately from unavailable token timing', async () => {
    const metric = {};
    await readPhoneModelResponse(Response.json({ choices: [{ message: { content: 'finish(message="ok")' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5 } }), metric, performance.now());
    expect(metric).toMatchObject({ firstByteMs: expect.any(Number), promptTokens: 5 });
    expect(metric).not.toHaveProperty('firstTokenMs');
  });
});


it('seals timing so detached heartbeats cannot overwrite a later operation', async () => {
  const trace = new PhoneExecutionTrace();
  await trace.run(async () => {
    await measurePhonePhase('capture', async () => {});
    trace.finish();
    const before = trace.snapshot();
    expect(currentPhoneTrace()).toBeUndefined();
    await measurePhonePhase('capture', async () => {});
    trace.model({ completionTokens: 100 });
    expect(trace.snapshot()).toEqual(before);
  });
});

it('waits for the terminal stream before exposing an otherwise valid action', async () => {
  let deliver!: (chunk: Uint8Array) => void; let end!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    deliver = chunk => controller.enqueue(chunk); end = () => controller.close();
  } });
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  let resolved = false;
  const result = readPhoneModelResponse(response, {}, performance.now()).then(value => { resolved = true; return value; });
  deliver(new TextEncoder().encode(`data: ${chunk('do(action="Back")')}\n\n`));
  await new Promise(resolve => setTimeout(resolve, 0)); expect(resolved).toBe(false);
  deliver(new TextEncoder().encode(`data: ${stop}\n\ndata: [DONE]\n\n`)); end();
  expect(await result).toMatchObject({ choices: [{ message: { content: 'do(action="Back")' } }] });
});


it.each([null, [], 42, 'invalid'])('rejects malformed JSON payloads as protocol errors (%s)', async value => {
  await expect(readPhoneModelResponse(Response.json(value), {}, performance.now())).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
});

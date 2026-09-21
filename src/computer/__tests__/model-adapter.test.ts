import { describe, expect, it, vi } from 'vitest';
import { ChatCompletionsComputerAdapter, GUI_PLUS_SYSTEM_PROMPT, GUI_PLUS_OBSERVATION_PROMPT, OpenAIResponsesComputerAdapter, parseGuiPlusProposal, predictComputerStep, readComputerJson } from '../model-adapter.js';
import { computerDiagnostic } from '../errors.js';

const call = (arguments_: unknown) => `<tool_call>${JSON.stringify({ name: 'computer_use', arguments: arguments_ })}</tool_call>`;
describe('GUI-Plus adapter', () => {
  it('defines only answer in the read-only hosted function signature', () => {
    const tool = JSON.parse(GUI_PLUS_OBSERVATION_PROMPT.match(/<tools>\n(.*)\n<\/tools>/)![1]);
    expect(tool.function.parameters.properties.action.enum).toEqual(['answer']);
    expect(tool.function.parameters.required).toEqual(['action', 'text']);
    expect(GUI_PLUS_OBSERVATION_PROMPT).toContain('Include both XML tags');
  });
  it('corrects one malformed observation without advertising or executing actions', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ name: 'computer_use', arguments: { action: 'answer', text: 'blue' } }) } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: call({ action: 'answer', text: 'blue' }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    expect(await predictComputerStep(adapter, { readOnly: true, goal: 'Describe', image: new Uint8Array([1]), mimeType: 'image/png', width: 1, height: 1, summary: '' }, () => {})).toEqual({ kind: 'answer', text: 'blue' });
    const prompt = JSON.parse(fetch.mock.calls[1][1].body).messages[0].content;
    expect(prompt).toContain('previous answer failed format validation');
    expect(prompt).not.toMatch(/left_click|pressKeys|computer_proposal/);
  });
  it('preserves safe model rejection diagnostics without raw provider prose', async () => {
    const requestId = crypto.randomUUID();
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 'max_input_tokens_exceeded', message: 'private prompt and secret key' } },
      { status: 400, headers: { 'x-xopc-request-id': requestId } }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    const error = await adapter.predict({ goal: 'Describe', readOnly: true, image: new Uint8Array([1]), mimeType: 'image/png', width: 1, height: 1, summary: '' }).catch(error => error);
    expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_MODEL_HTTP_400', phase: 'model', httpStatus: 400,
      requestId, serviceErrorCode: 'max_input_tokens_exceeded' });
    expect(error.message).not.toMatch(/private|secret/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['not json', 'x'.repeat(20_000), JSON.stringify({ error: { code: 'private-secret', message: 'private-secret' } })])('keeps the HTTP failure for invalid or untrusted error bodies', async body => {
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 400, headers: { 'x-xopc-request-id': 'private-secret' } }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    const error = await adapter.predict({ goal: 'Describe', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' }).catch(error => error);
    expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_MODEL_HTTP_400', httpStatus: 400 });
    expect(computerDiagnostic(error)?.requestId).toBeUndefined();
    expect(computerDiagnostic(error)?.serviceErrorCode).toBeUndefined();
    expect(error.message).not.toContain('private-secret');
  });
  it('uses a flat hosted signature without advertising unsupported native actions', () => {
    const tool = JSON.parse(GUI_PLUS_SYSTEM_PROMPT.match(/<tools>\n(.*)\n<\/tools>/)![1]);
    expect(tool.function.parameters.type).toBe('object');
    expect(tool.function.parameters.anyOf).toBeUndefined();
    expect(tool.function.parameters.properties.coordinate.type).toBe('array');
    expect(tool.function.parameters.properties.action.enum).not.toEqual(expect.arrayContaining(['mouse_move', 'left_click_drag', 'middle_click']));
  });
  it('refuses the malformed coordinate returned by a hosted grounding regression', () => {
    expect(() => parseGuiPlusProposal('<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":224, 205]}}</tool_call>', 800, 600)).toThrow('COMPUTER_INVALID_MODEL_OUTPUT');
  });
  it('honors the frozen service output ceiling and rejects invalid budgets', async () => {
    const connection = { modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' as const, maxOutputTokens: 512 };
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: call({ action: 'wait', time: 0 }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter(connection, fetch);
    await adapter.predict({ goal: 'Wait', image: new Uint8Array([1]), mimeType: 'image/png', width: 1, height: 1, summary: '' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(512);
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content[0].type).toBe('image_url');
    expect(() => new ChatCompletionsComputerAdapter({ ...connection, maxOutputTokens: 0 })).toThrow('COMPUTER_MODEL_OUTPUT_BUDGET');
  });
  it.each([
    { kind: 'action', action: { kind: 'wait', durationMs: 0 } },
    { kind: 'finished', claimedSuccess: true },
    { kind: 'takeover', reason: 'Please sign in' },
    { kind: 'answer', text: 'Visible text' },
  ])('supports complete structured decision semantics: $kind', async proposal => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { tool_calls: [{ function: {
      name: 'computer_proposal', arguments: JSON.stringify({ proposal }),
    } }] } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'structured-tools-v1' }, fetch);
    expect(await adapter.predict({ goal: 'Do the task', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' })).toEqual(proposal);
    expect(JSON.parse(fetch.mock.calls[0][1].body).tools[0].function.name).toBe('computer_proposal');
  });
  it('distinguishes a visual answer from a request for human intervention', () => {
    expect(parseGuiPlusProposal(call({ action: 'answer', text: 'A blue button' }), 800, 600)).toEqual({ kind: 'answer', text: 'A blue button' });
    expect(parseGuiPlusProposal(call({ action: 'interact', text: 'Please sign in' }), 800, 600)).toEqual({ kind: 'takeover', reason: 'Please sign in' });
  });
  it.each(['gui-plus-2026-02-26', 'structured-tools-v1'] as const)('reads without offering input tools using %s', async profile => {
    const message = profile === 'structured-tools-v1'
      ? { tool_calls: [{ function: { name: 'computer_observation', arguments: JSON.stringify({ text: 'A blue button' }) } }] }
      : { content: call({ action: 'answer', text: 'A blue button' }) };
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile }, fetch);
    expect(await adapter.predict({ readOnly: true, goal: 'Describe the page', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' }))
      .toEqual({ kind: 'answer', text: 'A blue button' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Do not propose or perform actions');
    expect(JSON.stringify(body.tools ?? [])).not.toMatch(/computer_action|typeText|pressKeys/);
  });
  it('rejects an action returned to a visual question', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: call({ action: 'left_click', coordinate: [500, 500] }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    await expect(adapter.predict({ readOnly: true, goal: 'Describe', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' })).rejects.toThrow('READ_ONLY_MODEL_OUTPUT');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 'Authorization', 'authorization', 'AUTHORIZATION'])('sends exactly one bearer credential with header %s', async name => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: call({ action: 'wait', time: 0 }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26',
      headers: { 'X-Test': 'preserved', ...(name ? { [name]: 'Bearer test' } : {}) }, deploymentRevision: 'revision' }, fetch);
    await adapter.predict({ goal: 'test', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBe('Bearer test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-test')).toBe('preserved');
    expect(headers.get('x-xopc-computer-deployment')).toBe('revision');
  });
  it('still rejects a conflicting authorization header', () => {
    expect(() => new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26',
      headers: { Authorization: 'Bearer other' } })).toThrow('COMPUTER_UNSUPPORTED_MODEL_HEADER');
  });
  it('allows one budgeted format re-prediction without changing the image or recipient', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>broken JSON</tool_call>' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: call({ action: 'left_click', coordinate: [500, 500] }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    const reserve = vi.fn();
    await expect(predictComputerStep(adapter, { goal: 'Click', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' }, reserve)).resolves.toMatchObject({ kind: 'action' });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
    const first = JSON.parse(fetch.mock.calls[0][1].body), second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.messages[1]).toEqual(second.messages[1]);
    expect(second.messages[0].content).toContain('previous output failed format validation');
    expect(second.messages[2]).toEqual({ role: 'assistant', content: '<tool_call>broken JSON</tool_call>' });
    expect(second.messages[3].content).toContain('invalid_json');
  });
  it.each(['COMPUTER_MODEL_HTTP_429', 'COMPUTER_MODEL_INVALID_JSON', 'COMPUTER_MODEL_INCOMPLETE_RESPONSE'])('never re-predicts for %s', async error => {
    const predict = vi.fn().mockRejectedValue(new Error(error));
    await expect(predictComputerStep({ predict } as any, { goal: 'Click', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' }, () => {})).rejects.toThrow(error);
    expect(predict).toHaveBeenCalledTimes(1);
  });
  it('checks the budget and abort before any format re-prediction', async () => {
    const predict = vi.fn().mockRejectedValue(new Error('COMPUTER_INVALID_MODEL_OUTPUT'));
    const input = { goal: 'Click', image: new Uint8Array(), mimeType: 'image/png' as const, width: 1, height: 1, summary: '' };
    let attempts = 0;
    await expect(predictComputerStep({ predict } as any, input, () => { if (++attempts > 1) throw new Error('budget'); })).rejects.toThrow('budget');
    expect(predict).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(predictComputerStep({ predict } as any, input, () => {}, controller.signal)).rejects.toThrow();
    expect(predict).toHaveBeenCalledTimes(1);
  });
  it('stops after two invalid predictions', async () => {
    const predict = vi.fn().mockRejectedValue(new Error('COMPUTER_INVALID_MODEL_OUTPUT'));
    await expect(predictComputerStep({ predict } as any, { goal: 'Click', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' }, () => {})).rejects.toThrow('COMPUTER_INVALID_MODEL_OUTPUT');
    expect(predict).toHaveBeenCalledTimes(2);
  });
  it('corrects the observed missing-coordinate-bracket failure with same-recipient feedback', async () => {
    const raw = '<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":497, 100]}}</tool_call>';
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: raw } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: call({ action: 'left_click', coordinate: [497, 100] }) } }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    expect(await predictComputerStep(adapter, { goal: 'Select Memories', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' }, () => {}))
      .toMatchObject({ action: { point: { x: 397, y: 60 } } });
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    expect(request.messages[2]).toEqual({ role: 'assistant', content: raw });
    expect(request.messages[3].content).toContain('No action was executed');
  });
  it('fails closed on malformed JSON without echoing private model content', async () => {
    for (const raw of ['private sensitive output', '{"name":"computer_use","arguments":{"action":"left_click","coordinate":[500,500],}}']) {
      let error: unknown;
      try { parseGuiPlusProposal(`<tool_call>${raw}</tool_call>`, 800, 600); } catch (caught) { error = caught; }
      expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_INVALID_MODEL_OUTPUT', validationReason: 'invalid_json' });
      expect(String(error)).not.toContain('private sensitive');
    }
    await expect(readComputerJson(new Response('private upstream response'), 1024)).rejects.toThrow(/^COMPUTER_MODEL_INVALID_JSON$/);
  });
  it('maps normalized coordinates to the actual image without aspect distortion', () => {
    expect(parseGuiPlusProposal(call({ action: 'left_click', coordinate: [250, 1000] }), 800, 600)).toEqual({ kind: 'action', action: { kind: 'click', point: { x: 200, y: 599 }, button: 'left', count: 1 } });
  });
  it('preserves Unicode and whitespace without implicit submission', () => {
    expect(parseGuiPlusProposal(call({ action: 'type', text: '  测试\n ', coordinate: [500, 500] }), 1, 1)).toMatchObject({ action: { text: '  测试\n ' } });
  });
  it.each([
    { action: 'triple_click', coordinate: [1, 1] }, { action: 'left_click', coordinate: [-1, 200] },
    { action: 'type', text: 'x', approved: true }, { action: 'wait', time: 30 },
  ])('rejects unsupported or malformed action %j', (args) => expect(() => parseGuiPlusProposal(call(args), 800, 600)).toThrow());
  it('rejects multiple calls, including a valid first action', () => {
    const text = call({ action: 'type', text: 'x' });
    expect(() => parseGuiPlusProposal(text + text, 800, 600)).toThrow('SINGLE_ACTION');
  });
  it('does not equate model termination to verified success', () => {
    expect(parseGuiPlusProposal(call({ action: 'terminate', status: 'success' }), 1, 1)).toEqual({ kind: 'finished', claimedSuccess: true });
  });
  it('preserves the scroll axis and direction', () => {
    expect(parseGuiPlusProposal(call({ action: 'hscroll', coordinate: [500, 500], pixels: 100 }), 800, 600)).toMatchObject({ action: { deltaX: -100, deltaY: 0 } });
  });
  it.each([
    [{ action: 'right_click', coordinate: [250, 500] }, { kind: 'click', point: { x: 200, y: 300 }, button: 'right', count: 1 }],
    [{ action: 'double_click', coordinate: [250, 500] }, { kind: 'click', point: { x: 200, y: 300 }, button: 'left', count: 2 }],
    [{ action: 'key', keys: ['shift', 'tab'] }, { kind: 'pressKeys', keys: ['shift', 'tab'] }],
    [{ action: 'scroll', coordinate: [500, 500], pixels: -200 }, { kind: 'scroll', point: { x: 400, y: 300 }, deltaY: 200, deltaX: 0 }],
    [{ action: 'wait', time: 0.5 }, { kind: 'wait', durationMs: 500 }],
  ])('maps supported GUI action %j', (args, action) => {
    expect(parseGuiPlusProposal(call(args), 800, 600)).toEqual({ kind: 'action', action });
  });
  it.each([
    { action: 'key', keys: ['invalid key!'] }, { action: 'answer', text: '' },
    { action: 'scroll', coordinate: [1, 1], pixels: 0 },
  ])('classifies invalid converted actions without leaking Zod output: %j', args => {
    let error: unknown;
    try { parseGuiPlusProposal(call(args), 800, 600); } catch (caught) { error = caught; }
    expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_INVALID_MODEL_OUTPUT', validationReason: 'invalid_arguments' });
  });
  it('requires TLS and forbids credentials in the URL', () => {
    expect(() => new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'http://example.com/v1', apiKey: 'test', profile: 'structured-tools-v1' })).toThrow();
  });
  it('never retries a vendor failure or includes the error body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('private upstream information', { status: 429 }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    await expect(adapter.predict({ goal: 'test', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' })).rejects.toThrow('COMPUTER_MODEL_HTTP_429');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ temperature: 0, presence_penalty: 0, enable_thinking: false });
  });
});

describe('OpenAI Responses computer adapter', () => {
  const connection = { modelId: 'gpt-computer', baseUrl: 'https://api.example.com/v1', apiKey: 'test',
    profile: 'openai-responses-computer-v1' as const };
  const input = { goal: 'Open filters', image: new Uint8Array([1, 2]), mimeType: 'image/png' as const,
    width: 800, height: 600, summary: '{"text":"Filters"}', stateDigest: 'state-1' };

  it('uses the native computer tool and maps a single action', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'resp_1', status: 'completed', output: [{
      type: 'computer_call', call_id: 'call_1', actions: [{ type: 'click', button: 'left', x: 40, y: 50 }],
    }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    await expect(adapter.predict(input)).resolves.toEqual({ kind: 'action', action: {
      kind: 'click', point: { x: 40, y: 50 }, button: 'left', count: 1,
    } });
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/v1/responses');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toEqual([{ type: 'computer' }]);
    expect(body.input[0].content[0]).toMatchObject({ type: 'input_image', detail: 'original' });
    expect(body.instructions).toContain('Goal: Open filters');
  });

  it('serializes a native action batch through the one-action broker boundary', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', status: 'completed', output: [{ type: 'computer_call', call_id: 'call_1', actions: [
        { type: 'click', button: 'left', x: 40, y: 50 }, { type: 'type', text: 'penguin' },
      ] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', status: 'completed', output_text: 'Done', output: [] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    const click = (await adapter.predict(input) as any).action;
    expect(click.kind).toBe('click');
    const typed = (await adapter.predict({ ...input, history: [{ goal: input.goal, action: 'click', actionPreview: JSON.stringify(click),
      dispatch: 'completed', outcome: 'unknown', after: '', afterStateDigest: input.stateDigest }] }) as any).action;
    expect(typed).toEqual({ kind: 'typeText', text: 'penguin', point: { x: 40, y: 50 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(adapter.predict({ ...input, history: [{ goal: input.goal, action: 'typeText', actionPreview: JSON.stringify(typed),
      dispatch: 'completed', outcome: 'unknown', after: '', afterStateDigest: input.stateDigest }] })).resolves.toEqual({ kind: 'answer', text: 'Done' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const continuation = JSON.parse(fetch.mock.calls[1][1].body);
    expect(continuation.previous_response_id).toBe('resp_1');
    expect(continuation.input[0]).toMatchObject({ type: 'computer_call_output', call_id: 'call_1',
      output: { type: 'computer_screenshot', detail: 'original' } });
  });

  it('drops the remaining batch after an unconfirmed action and replans from the screenshot', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1', actions: [
        { type: 'click', button: 'left', x: 1, y: 2 }, { type: 'type', text: 'must-not-run' },
      ] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2', actions: [{ type: 'wait' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    await adapter.predict(input);
    await expect(adapter.predict(input)).resolves.toEqual({ kind: 'action', action: { kind: 'wait', durationMs: 500 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('drops the remaining batch when the window changes after the completed action', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1', actions: [
        { type: 'click', button: 'left', x: 1, y: 2 }, { type: 'type', text: 'stale' },
      ] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2', actions: [{ type: 'wait' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    const click = (await adapter.predict(input) as any).action;
    await expect(adapter.predict({ ...input, stateDigest: 'state-2', history: [{ goal: input.goal, action: 'click',
      actionPreview: JSON.stringify(click), dispatch: 'completed', outcome: 'unknown', after: '', afterStateDigest: 'state-1' }] }))
      .resolves.toEqual({ kind: 'action', action: { kind: 'wait', durationMs: 500 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not carry queued actions into a different goal', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1', actions: [
        { type: 'click', button: 'left', x: 1, y: 2 }, { type: 'type', text: 'stale' },
      ] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2', actions: [{ type: 'wait' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    const click = (await adapter.predict(input) as any).action;
    await expect(adapter.predict({ ...input, goal: 'A different task', history: [{ goal: input.goal, action: 'click',
      actionPreview: JSON.stringify(click), dispatch: 'completed', outcome: 'unknown', after: '', afterStateDigest: input.stateDigest }] }))
      .resolves.toEqual({ kind: 'action', action: { kind: 'wait', durationMs: 500 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses a click point for typing only inside the same native batch', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1',
        actions: [{ type: 'click', button: 'left', x: 20, y: 30 }] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2', actions: [{ type: 'type', text: 'next' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    const click = (await adapter.predict(input) as any).action;
    await expect(adapter.predict({ ...input, history: [{ goal: input.goal, action: 'click', actionPreview: JSON.stringify(click),
      dispatch: 'completed', outcome: 'unknown', after: '', afterStateDigest: input.stateDigest }] })).resolves.toEqual({ kind: 'action', action: { kind: 'typeText', text: 'next' } });
  });

  it('keeps observation requests read-only and returns visible text', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'resp_read', output: [{ type: 'message', content: [
      { type: 'output_text', text: 'The Filters panel is closed.' },
    ] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    await expect(adapter.predict({ ...input, readOnly: true })).resolves.toEqual({ kind: 'answer', text: 'The Filters panel is closed.' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
  });

  it('cancels an unfinished control batch before a read-only observation', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1', actions: [
        { type: 'click', button: 'left', x: 1, y: 2 }, { type: 'type', text: 'must-not-run' },
      ] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_read', output_text: 'Observed', output: [] }))
      .mockResolvedValueOnce(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2', actions: [{ type: 'wait' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    await adapter.predict(input);
    await expect(adapter.predict({ ...input, readOnly: true })).resolves.toEqual({ kind: 'answer', text: 'Observed' });
    await expect(adapter.predict(input)).resolves.toEqual({ kind: 'action', action: { kind: 'wait', durationMs: 500 } });
    expect(JSON.parse(fetch.mock.calls[2][1].body).previous_response_id).toBeUndefined();
  });

  it('hands unsupported pointer movement back to the user instead of approximating it', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1',
      actions: [{ type: 'move', x: 5, y: 6 }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter(connection, fetch);
    await expect(adapter.predict(input)).resolves.toMatchObject({ kind: 'takeover' });
  });

  it('maps an exact two-point drag and refuses a curved path', async () => {
    const straight = vi.fn().mockResolvedValue(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1',
      actions: [{ type: 'drag', path: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }] }] }));
    await expect(new OpenAIResponsesComputerAdapter(connection, straight).predict(input)).resolves.toEqual({ kind: 'action', action: {
      kind: 'drag', from: { x: 10, y: 20 }, to: { x: 30, y: 40 },
    } });
    const curved = vi.fn().mockResolvedValue(Response.json({ id: 'resp_2', output: [{ type: 'computer_call', call_id: 'call_2',
      actions: [{ type: 'drag', path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }] }] }));
    await expect(new OpenAIResponsesComputerAdapter(connection, curved).predict(input)).resolves.toMatchObject({ kind: 'takeover' });
  });
});

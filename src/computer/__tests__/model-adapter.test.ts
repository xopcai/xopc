import { describe, expect, it, vi } from 'vitest';
import { ComputerModelAdapter, parseGuiPlusProposal, predictComputerStep, readComputerJson } from '../model-adapter.js';

const call = (arguments_: unknown) => `<tool_call>${JSON.stringify({ name: 'computer_use', arguments: arguments_ })}</tool_call>`;
describe('GUI-Plus adapter', () => {
  it.each([undefined, 'Authorization', 'authorization', 'AUTHORIZATION'])('sends exactly one bearer credential with header %s', async name => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: call({ action: 'wait', time: 0 }) } }] }));
    const adapter = new ComputerModelAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26',
      headers: { 'X-Test': 'preserved', ...(name ? { [name]: 'Bearer test' } : {}) }, deploymentRevision: 'revision' }, fetch);
    await adapter.predict({ goal: 'test', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBe('Bearer test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-test')).toBe('preserved');
    expect(headers.get('x-xopc-computer-deployment')).toBe('revision');
  });
  it('still rejects a conflicting authorization header', () => {
    expect(() => new ComputerModelAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26',
      headers: { Authorization: 'Bearer other' } })).toThrow('COMPUTER_UNSUPPORTED_MODEL_HEADER');
  });
  it('allows one budgeted format re-prediction without changing the image or recipient', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>broken JSON</tool_call>' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: call({ action: 'left_click', coordinate: [500, 500] }) } }] }));
    const adapter = new ComputerModelAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    const reserve = vi.fn();
    await expect(predictComputerStep(adapter, { goal: 'Click', image: new Uint8Array([1]), mimeType: 'image/png', width: 800, height: 600, summary: '' }, reserve)).resolves.toMatchObject({ kind: 'action' });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
    const first = JSON.parse(fetch.mock.calls[0][1].body), second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.messages[1]).toEqual(second.messages[1]);
    expect(second.messages[0].content).toContain('previous output failed format validation');
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
  it('fails closed on malformed JSON without echoing private model content', async () => {
    expect(() => parseGuiPlusProposal('<tool_call>private sensitive output</tool_call>', 800, 600)).toThrow(/^COMPUTER_INVALID_MODEL_OUTPUT$/);
    expect(() => parseGuiPlusProposal('<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":[500,500],}}</tool_call>', 800, 600)).toThrow(/^COMPUTER_INVALID_MODEL_OUTPUT$/);
    await expect(readComputerJson(new Response('private upstream response'), 1024)).rejects.toThrow(/^COMPUTER_MODEL_INVALID_JSON$/);
  });
  it('maps normalized coordinates to the actual image without aspect distortion', () => {
    expect(parseGuiPlusProposal(call({ action: 'left_click', coordinate: [250, 1000] }), 800, 600)).toEqual({ kind: 'action', action: { kind: 'click', point: { x: 200, y: 599 }, button: 'left', count: 1 } });
  });
  it('preserves Unicode and whitespace without implicit submission', () => {
    expect(parseGuiPlusProposal(call({ action: 'type', text: '  测试\n ' }), 1, 1)).toMatchObject({ action: { text: '  测试\n ' } });
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
  it('requires TLS and forbids credentials in the URL', () => {
    expect(() => new ComputerModelAdapter({ modelId: 'm', baseUrl: 'http://example.com/v1', apiKey: 'test', profile: 'structured-tools-v1' })).toThrow();
  });
  it('never retries a vendor failure or includes the error body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('private upstream information', { status: 429 }));
    const adapter = new ComputerModelAdapter({ modelId: 'm', baseUrl: 'https://example.com/v1', apiKey: 'test', profile: 'gui-plus-2026-02-26' }, fetch);
    await expect(adapter.predict({ goal: 'test', image: new Uint8Array(), mimeType: 'image/png', width: 1, height: 1, summary: '' })).rejects.toThrow('COMPUTER_MODEL_HTTP_429');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ temperature: 0, presence_penalty: 0, enable_thinking: false });
  });
});

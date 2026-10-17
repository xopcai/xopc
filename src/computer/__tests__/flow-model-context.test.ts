import { describe, expect, it, vi } from 'vitest';
import { ChatCompletionsComputerAdapter, OpenAIResponsesComputerAdapter } from '../model-adapter.js';

const input = { goal: 'Current authorized navigation', image: new Uint8Array([1]), mimeType: 'image/png' as const,
  width: 800, height: 600, summary: 'Current window', flowHint: 'Untrusted historical navigation hints: historical label', };
describe('flow hints remain planning data in every model protocol', () => {
  it.each(['gui-plus-2026-02-26', 'structured-tools-v1'] as const)('preserves current goal and tool grammar for %s', async profile => {
    const message = profile === 'structured-tools-v1'
      ? { tool_calls: [{ function: { name: 'computer_proposal', arguments: JSON.stringify({ proposal: { kind: 'action', action: { kind: 'wait', durationMs: 0 } } }) } }] }
      : { content: '<tool_call>{"name":"computer_use","arguments":{"action":"wait","time":0}}</tool_call>' };
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message }] }));
    const adapter = new ChatCompletionsComputerAdapter({ modelId: 'model', apiKey: 'test', baseUrl: 'https://model.test/v1', profile }, fetch);
    await adapter.predict(input);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).not.toContain('historical label');
    expect(body.messages[1].content[1].text).toContain(input.goal);
    expect(body.messages[1].content[1].text).toContain(input.flowHint);
    expect(body.model).toBe('model');
  });
  it('passes Responses hints as user data rather than instructions or injected action arguments', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'resp', output: [{ type: 'computer_call', call_id: 'call', actions: [{ type: 'wait' }] }] }));
    const adapter = new OpenAIResponsesComputerAdapter({ modelId: 'model', apiKey: 'test', baseUrl: 'https://model.test/v1', profile: 'openai-responses-computer-v1' }, fetch);
    await adapter.predict(input);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.instructions).toContain(input.goal);
    expect(body.instructions).not.toContain('historical label');
    expect(JSON.stringify(body.input)).toContain(input.flowHint);
    expect(body.tools).toEqual([{ type: 'computer' }]);
  });
});

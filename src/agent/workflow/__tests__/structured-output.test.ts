import { describe, expect, it } from 'vitest';

import {
  createStructuredOutputTool,
  STRUCTURED_OUTPUT_TOOL_NAME,
  type StructuredOutputCapture,
} from '../structured-output-tool.js';

describe('createStructuredOutputTool', () => {
  it('captures valid arguments and terminates the agent loop', async () => {
    const capture: StructuredOutputCapture<{ ok: boolean }> = { called: false };
    const tool = createStructuredOutputTool({
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      capture,
    });

    expect(tool.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);

    const result = await tool.execute('call-1', { ok: true } as any);
    expect(capture.called).toBe(true);
    expect(capture.value).toEqual({ ok: true });
    expect(result.terminate).toBe(true);
  });

  it('returns an error result (no terminate) on invalid arguments', async () => {
    const capture: StructuredOutputCapture<{ ok: boolean }> = { called: false };
    const tool = createStructuredOutputTool({
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      capture,
    });

    const result = await tool.execute('call-1', { ok: 'yes' } as any);
    expect(capture.called).toBe(false);
    expect(result.terminate).toBeUndefined();
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toMatch(/invalid arguments/i);
  });
});

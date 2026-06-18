import { describe, expect, it } from 'vitest';

import { parseTuiToolResult } from '../tui-tool-result.js';

describe('parseTuiToolResult', () => {
  it('extracts text and details from serialized agent tool envelopes', () => {
    const result = parseTuiToolResult(
      JSON.stringify({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', mimeType: 'image/png', data: 'abc' },
        ],
        details: { path: 'out.png' },
      }),
    );

    expect(result.text).toBe('hello\n[image:image/png]');
    expect(result.envelope?.details).toEqual({ path: 'out.png' });
    expect(result.wasJsonEnvelope).toBe(true);
  });
});

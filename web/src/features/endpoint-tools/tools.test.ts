import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeWebEndpointTool } from './tools';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web endpoint tools', () => {
  it('reads selection without accepting undeclared arguments', async () => {
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => 'selected text' }),
    });
    await expect(executeWebEndpointTool('web.page.get_selection', {})).resolves.toEqual({
      text: 'selected text',
    });
    await expect(executeWebEndpointTool('web.page.get_selection', { extra: true })).rejects.toThrow(
      'exactly',
    );
  });

  it('writes the clipboard only from a focused page', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', { hasFocus: () => true });
    await expect(executeWebEndpointTool('web.clipboard.write', { text: 'hello' })).resolves.toEqual({
      text: 'Clipboard updated.',
    });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('rejects non-web navigation schemes', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } });
    await expect(executeWebEndpointTool('web.page.navigate', { url: 'javascript:alert(1)' }))
      .rejects.toThrow('HTTP or HTTPS');
  });
});

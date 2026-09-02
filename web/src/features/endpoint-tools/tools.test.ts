import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndpointToolRegistry, type EndpointToolExecutionContext } from '@xopcai/endpoint-tools-client';

import { WEB_ENDPOINT_TOOL_DEFINITIONS } from './tools';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web endpoint tools', () => {
  const registry = new EndpointToolRegistry(WEB_ENDPOINT_TOOL_DEFINITIONS);
  const execute = (name: string, args: Record<string, unknown>, context: EndpointToolExecutionContext) =>
    registry.get(name)!.definition.execute(args, context);
  const uploadFile = vi.fn(async (file: { name: string; mimeType: string; bytes: Uint8Array }) => ({
    type: 'file' as const,
    fileId: 'file-1',
    name: file.name,
    mimeType: file.mimeType,
    size: file.bytes.byteLength,
    sha256: 'a'.repeat(64),
  }));
  const context = {
    uploadFile,
    invocationId: 'invocation-1',
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
  };

  it('reads selection without accepting undeclared arguments', async () => {
    vi.stubGlobal('window', {
      getSelection: () => ({ toString: () => 'selected text' }),
    });
    await expect(execute('web.page.get_selection', {}, context)).resolves.toEqual({
      content: [{ type: 'text', text: 'selected text' }],
    });
    await expect(execute('web.page.get_selection', { extra: true }, context)).rejects.toThrow(
      'exactly',
    );
  });

  it('writes the clipboard only from a focused page', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', { hasFocus: () => true });
    await expect(execute('web.clipboard.write', { text: 'hello' }, context)).resolves.toEqual({
      content: [{ type: 'text', text: 'Clipboard updated.' }],
    });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('rejects non-web navigation schemes', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } });
    await expect(execute('web.page.navigate', { url: 'javascript:alert(1)' }, context))
      .rejects.toThrow('HTTP or HTTPS');
  });

  it('opens the file picker synchronously under a current user activation', async () => {
    const file = {
      name: 'note.txt',
      type: 'text/plain',
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    const input = {
      type: '',
      multiple: true,
      files: [file],
      onchange: null as null | (() => void),
      oncancel: null as null | (() => void),
      click: vi.fn(() => input.onchange?.()),
    };
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    vi.stubGlobal('document', { createElement: vi.fn(() => input) });

    await expect(execute('web.file.pick', {}, context)).resolves.toEqual({
      content: [expect.objectContaining({ type: 'file', fileId: 'file-1', name: 'note.txt' })],
    });
    expect(input.click).toHaveBeenCalledOnce();
    expect(uploadFile).toHaveBeenCalledWith({
      name: 'note.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('fails closed when the confirmation gesture is no longer active', async () => {
    const createElement = vi.fn();
    vi.stubGlobal('navigator', { userActivation: { isActive: false } });
    vi.stubGlobal('document', { createElement });
    await expect(execute('web.file.pick', {}, context)).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
    expect(createElement).not.toHaveBeenCalled();
  });

  it('downloads bounded text under the same current user activation', async () => {
    const anchor = { href: '', download: '', click: vi.fn() };
    const createObjectURL = vi.fn(() => 'blob:file');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    await expect(execute(
      'web.file.download',
      { suggestedName: 'result.txt', content: 'done' },
      context,
    )).resolves.toEqual({
      content: [{ type: 'text', text: 'Download started: result.txt' }],
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file');
  });
});

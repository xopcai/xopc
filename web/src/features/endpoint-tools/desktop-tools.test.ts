import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointToolRegistry, type EndpointToolExecutionContext } from '@xopcai/endpoint-tools-client';

import { DESKTOP_ENDPOINT_TOOL_DEFINITIONS } from './desktop-tools';

describe('desktop endpoint tools', () => {
  const registry = new EndpointToolRegistry(DESKTOP_ENDPOINT_TOOL_DEFINITIONS);
  const execute = (name: string, args: Record<string, unknown>, context: EndpointToolExecutionContext) =>
    registry.get(name)!.definition.execute(args, context);
  const writeText = vi.fn(async () => true);
  const readText = vi.fn(async () => 'copied text');
  const openExternalUrl = vi.fn(async () => ({ ok: true as const }));
  const pickEndpointFile = vi.fn(async (): Promise<{
    name: string; mimeType: string; size: number; dataBase64: string;
  } | null> => ({
    name: 'note.txt', mimeType: 'text/plain', size: 5, dataBase64: 'aGVsbG8=',
  }));
  const saveEndpointText = vi.fn(async () => ({ saved: true as const, name: 'answer.txt' }));
  const showEndpointNotification = vi.fn(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => ({ ok: true }));
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      electronAPI: {
        platform: 'darwin',
        clipboard: { writeText, readText },
        shell: { openExternalUrl },
        file: { pickEndpointFile, saveEndpointText },
        system: { showEndpointNotification },
      },
    });
  });

  it('uses the constrained Electron clipboard bridge', async () => {
    await expect(execute('desktop.clipboard.read', {}, context))
      .resolves.toEqual({ content: [{ type: 'text', text: 'copied text' }] });
    await expect(execute('desktop.clipboard.write', { text: 'next' }, context))
      .resolves.toEqual({ content: [{ type: 'text', text: 'Clipboard updated.' }] });
    expect(writeText).toHaveBeenCalledWith('next');
  });

  it('allows only HTTP(S) external URLs', async () => {
    await expect(execute('desktop.app.open_external', { url: 'file:///tmp/a' }, context))
      .rejects.toThrow('Only HTTP and HTTPS');
    await execute('desktop.app.open_external', { url: 'https://example.com/a' }, context);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a');
  });

  it('uploads only the file explicitly returned by the native picker', async () => {
    await expect(execute('desktop.file.pick', {}, context)).resolves.toEqual({
      content: [expect.objectContaining({ type: 'file', fileId: 'file-1', name: 'note.txt' })],
    });
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'note.txt', mimeType: 'text/plain', bytes: new Uint8Array([104, 101, 108, 108, 111]),
    }));
  });

  it('treats native picker cancellation as a user denial', async () => {
    pickEndpointFile.mockResolvedValueOnce(null);
    await expect(execute('desktop.file.pick', {}, context)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('saves bounded text through the native save dialog', async () => {
    await expect(execute(
      'desktop.file.save',
      { suggestedName: 'answer.txt', content: 'done' },
      context,
    )).resolves.toEqual({ content: [{ type: 'text', text: 'Saved answer.txt' }] });
    expect(saveEndpointText).toHaveBeenCalledWith({ suggestedName: 'answer.txt', content: 'done' });
  });

  it('shows bounded native notifications through the trusted bridge', async () => {
    await expect(execute(
      'desktop.notification.show',
      { title: 'Finished', body: 'Your task is ready.' },
      context,
    )).resolves.toEqual({ content: [{ type: 'text', text: 'Notification shown.' }] });
    expect(showEndpointNotification).toHaveBeenCalledWith({ title: 'Finished', body: 'Your task is ready.' });
  });

  it('reports denied desktop notification permission', async () => {
    showEndpointNotification.mockResolvedValueOnce({ ok: false as const, error: 'PERMISSION_DENIED' });
    await expect(execute(
      'desktop.notification.show',
      { title: 'Finished', body: 'Your task is ready.' },
      context,
    )).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

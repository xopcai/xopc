import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

import { computerDiagnostic, ComputerOperationError } from '../../../src/computer/errors.js';
import { uploadDesktopFrame } from '../frame-upload.js';
import { executeComputerCommand } from '../execute-command.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function options() {
  const invocationId = randomUUID();
  return { base: 'http://127.0.0.1:1', token: 'secret-auth', endpointId: 'desktop', invocationId,
    signal: new AbortController().signal,
    grant: { path: `/api/endpoint-tools/invocations/${invocationId}/files`, token: 'secret-grant', expiresAt: Date.now() + 60_000, maxBytes: 5_242_880, maxFiles: 1 },
    file: { name: 'observation.png', mimeType: 'image/png', bytes: Buffer.from('private pixels') } };
}
it.each([400, 401, 413, 429, 500])('retains HTTP %s and a correlation ID, never raw response bodies or credentials', async (status) => {
  const fetcher = vi.fn(async () => new Response('secret backend exception', { status }));
  vi.stubGlobal('fetch', fetcher);
  const opts = options();
  const error = await uploadDesktopFrame(opts).catch(error => error);
  const diagnostic = computerDiagnostic(error);
  expect(diagnostic).toMatchObject({ errorCode: `COMPUTER_FRAME_UPLOAD_HTTP_${status}`, phase: 'frame_upload', httpStatus: status });
  expect(fetcher.mock.calls[0]![1].headers['x-request-id']).toBe(diagnostic!.diagnosticId);
  expect(error.message).not.toMatch(/secret|private pixels/);
  expect(fetcher.mock.calls[0]![1].body.every((b: number) => b === 0)).toBe(true);
});
it('maps only allowlisted server error codes', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'INVALID_COMPUTER_FRAME', message: 'private data' } }, { status: 400 }));
  const error = await uploadDesktopFrame(options()).catch(error => error);
  expect(computerDiagnostic(error)?.errorCode).toBe('COMPUTER_FRAME_UPLOAD_INVALID_IMAGE');
  expect(error.message).not.toContain('private');
});
it('cancels uploads with the operation and never retries', async () => {
  const abort = new AbortController();
  const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  vi.stubGlobal('fetch', fetcher);
  const opts = options();
  const pending = uploadDesktopFrame({ ...opts, signal: abort.signal }).catch(error => error);
  abort.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects cross-invocation paths before making a request', async () => {
  const opts = options(); opts.grant.path = '/api/endpoint-tools/invocations/other/files';
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(uploadDesktopFrame(opts)).rejects.toThrow('COMPUTER_FRAME_UPLOAD_INVALID_GRANT');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([false, true])('stops and clears pixels after failed uploads, preserving existing receipts: %s', async (dispatched) => {
  const pixels = Buffer.from('private screenshot');
  const receipt = { actionId: 'action', dispatch: 'completed', outcome: 'unknown', verification: 'visual' };
  const broker = { command: vi.fn().mockResolvedValue({ status: 'ready', sessionId: 'session', brokerEpoch: 'epoch', generation: 0,
    ...(dispatched ? { receipt } : {}), frame: { bytes: pixels, mimeType: 'image/png' } }),
    cancel: dispatched ? vi.fn().mockRejectedValue(new Error('cleanup failed')) : vi.fn().mockResolvedValue(undefined) };
  const failure = new ComputerOperationError({ errorCode: 'COMPUTER_FRAME_UPLOAD_HTTP_413', phase: 'frame_upload', diagnosticId: randomUUID(), httpStatus: 413 });
  const command = { op: 'observe' as const, owner: 'owner', sessionId: 'session' };
  const pending = executeComputerCommand(broker, command, { signal: new AbortController().signal, invocationId: 'invocation',
    reportProgress: vi.fn(), uploadFile: vi.fn().mockRejectedValue(failure) });
  if (dispatched) {
    expect(await pending).toMatchObject({ content: [{ type: 'json', value: { status: 'stopped', receipt,
      errorCode: 'COMPUTER_FRAME_UPLOAD_HTTP_413', diagnostic: { httpStatus: 413 } } }] });
  } else await expect(pending).rejects.toBe(failure);
  expect(broker.cancel).toHaveBeenCalledWith(command);
  expect(pixels.every(b => b === 0)).toBe(true);
});

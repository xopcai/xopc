import { createHash, randomUUID } from 'node:crypto';

import type { EndpointToolFile, EndpointToolUploadGrant } from '@xopcai/endpoint-tools-client';
import { endpointToolContentSchema } from '@xopcai/endpoint-tools-protocol';

import { ComputerOperationError } from '../../src/computer/errors.js';

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upload response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) throw new Error('Upload response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function uploadDesktopFrame(options: {
  base: string; token: string; endpointId: string; invocationId: string; signal: AbortSignal;
  grant: EndpointToolUploadGrant; file: EndpointToolFile;
}) {
  const { grant, file, signal } = options;
  const diagnosticId = randomUUID();
  const fail = (suffix: string, httpStatus?: number): never => {
    throw new ComputerOperationError({ errorCode: `COMPUTER_FRAME_UPLOAD_${suffix}`,
      phase: 'frame_upload', diagnosticId, ...(httpStatus ? { httpStatus } : {}) });
  };
  signal.throwIfAborted();
  if (!grant || grant.path !== `/api/endpoint-tools/invocations/${encodeURIComponent(options.invocationId)}/files`
    || grant.expiresAt <= Date.now()) return fail('INVALID_GRANT');
  if (file.bytes.length > grant.maxBytes) return fail('TOO_LARGE');
  const timeout = AbortSignal.timeout(15_000);
  const body = Buffer.from(file.bytes);
  try {
    let response: Response;
    try {
      response = await fetch(`${options.base}${grant.path}?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': file.mimeType,
          'x-endpoint-id': options.endpointId, 'x-endpoint-upload-token': grant.token, 'x-request-id': diagnosticId },
        body, signal: AbortSignal.any([signal, timeout]),
      });
    } catch {
      signal.throwIfAborted();
      return fail(timeout.aborted ? 'TIMEOUT' : 'NETWORK');
    }
    let parsed: any;
    try { parsed = await readResponse(response); } catch {
      signal.throwIfAborted();
      if (timeout.aborted) return fail('TIMEOUT', response.status);
      if (response.ok) return fail('INVALID_RESPONSE', response.status);
    }
    signal.throwIfAborted();
    if (!response.ok) {
      const codes: Record<string, string> = { INVALID_UPLOAD_GRANT: 'INVALID_GRANT', UPLOAD_TOO_LARGE: 'TOO_LARGE',
        INVALID_COMPUTER_FRAME: 'INVALID_IMAGE', UPLOAD_BUSY: 'BUSY' };
      const code = parsed?.error?.code;
      return fail(typeof code === 'string' && Object.hasOwn(codes, code) ? codes[code] : `HTTP_${response.status}`, response.status);
    }
    const result = endpointToolContentSchema.safeParse(parsed?.payload);
    if (parsed?.ok !== true || !result.success || result.data.type !== 'file'
      || result.data.name !== file.name || result.data.mimeType !== file.mimeType || result.data.size !== file.bytes.length
      || result.data.sha256 !== createHash('sha256').update(file.bytes).digest('hex')) return fail('INVALID_RESPONSE', response.status);
    return result.data;
  } finally { body.fill(0); }
}

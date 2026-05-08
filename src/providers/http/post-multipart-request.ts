/**
 * Provider HTTP — multipart/form-data POST helper.
 *
 * Browser-style {@link FormData} is constructed by the caller. We do NOT set
 * `Content-Type` manually so that the runtime fills in the correct multipart
 * boundary.
 */

import { createLogger } from '../../utils/logger.js';
import { assertOk } from './assert-ok.js';
import { resolveDeadline } from './deadline.js';
import { assertNotPrivateNetwork, type PrivateNetworkPolicy } from './private-network.js';

const log = createLogger('ProviderHttp');

export interface MultipartFilePart {
  /** Field name, e.g. "image". */
  field: string;
  /** Binary payload. */
  buffer: Buffer | Uint8Array;
  /** File name reported to the server. */
  fileName: string;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
}

export interface PostMultipartRequestOptions {
  providerId: string;
  url: string;
  /** Plain string fields. */
  fields?: Record<string, string>;
  /** Binary file parts. */
  files?: MultipartFilePart[];
  /** Extra headers; do NOT set `Content-Type`. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  providerDefaultTimeoutMs?: number;
  signal?: AbortSignal;
  networkPolicy?: PrivateNetworkPolicy;
  fetchImpl?: typeof fetch;
}

export async function postMultipartRequest(options: PostMultipartRequestOptions): Promise<Response> {
  assertNotPrivateNetwork(options.url, options.networkPolicy);

  const deadline = resolveDeadline({
    timeoutMs: options.timeoutMs,
    providerDefaultMs: options.providerDefaultTimeoutMs,
    signal: options.signal,
  });

  const form = new FormData();
  for (const [k, v] of Object.entries(options.fields ?? {})) {
    if (typeof v === 'string') form.append(k, v);
  }
  for (const part of options.files ?? []) {
    const u8 = part.buffer instanceof Uint8Array ? part.buffer : new Uint8Array(part.buffer);
    // Copy into a fresh Uint8Array so the underlying ArrayBuffer satisfies the
    // `BlobPart` contract regardless of whether the caller passed a Node Buffer.
    const copy = new Uint8Array(u8.byteLength);
    copy.set(u8);
    form.append(part.field, new Blob([copy], { type: part.mimeType }), part.fileName);
  }

  // Strip any caller-supplied content-type to let runtime set the boundary.
  const headers = lowerCaseHeaderKeys(options.headers);
  delete headers['content-type'];

  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(options.url, {
      method: 'POST',
      headers,
      body: form,
      signal: deadline.signal,
    });
  } catch (err) {
    deadline.cleanup();
    const em = err instanceof Error ? err.message : String(err);
    log.warn(
      {
        providerId: options.providerId,
        url: options.url,
        durationMs: Date.now() - startedAt,
        timeoutMs: deadline.timeoutMs,
        errorMessage: em,
      },
      `Multipart POST transport failed: ${em}`,
    );
    throw err;
  }
  deadline.cleanup();

  log.debug(
    {
      providerId: options.providerId,
      url: options.url,
      status: res.status,
      durationMs: Date.now() - startedAt,
      timeoutMs: deadline.timeoutMs,
    },
    `Multipart POST ${res.status}`,
  );

  return assertOk(res, options.url);
}

function lowerCaseHeaderKeys(input?: Record<string, string>): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

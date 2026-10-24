import { modelResponseMetadata } from './response-metadata.js';
import type { classifyModelActionEnvelope } from './protocol-envelope-diagnostics.js';
import type { classifyAlternativeActionContracts } from './protocol-alternatives.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

type ReadIssue = 'body_missing' | 'too_large' | 'invalid_json' | 'read_failed';
export type ContentDiagnostics = ReturnType<typeof classifyModelActionEnvelope> & { wholeResponseParseable: boolean; wholeResponseCode?: 'PHONE_MODEL_PROTOCOL' | 'PHONE_APP_DENIED' | 'OTHER'; alternatives?: ReturnType<typeof classifyAlternativeActionContracts> };
export type ResponseMetadataRead = { bytes: number; metadata?: ReturnType<typeof modelResponseMetadata>; protocolEnvelope?: ContentDiagnostics; readIssue?: ReadIssue };

/** The original response remains readable by the production adapter. */
export async function readResponseMetadata(response: Response, maxBytes = MAX_RESPONSE_BYTES, inspectContent?: (raw: string) => ContentDiagnostics): Promise<ResponseMetadataRead> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) throw new RangeError('Invalid metadata byte limit');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bytes = 0;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return { bytes, readIssue: 'body_missing' };
    const parts: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        // A tee cancellation may wait for the original branch. Do not await it here.
        void reader.cancel().catch(() => {});
        return { bytes, readIssue: 'too_large' };
      }
      parts.push(part.value);
    }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { return { bytes, readIssue: 'invalid_json' }; }
    const root = payload as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = Array.isArray(root?.choices) ? root.choices[0]?.message?.content : undefined;
    const protocolEnvelope = inspectContent && typeof content === 'string' ? inspectContent(content) : undefined;
    return { bytes, metadata: modelResponseMetadata(payload), protocolEnvelope };
  } catch {
    if (reader) void reader.cancel().catch(() => {});
    return { bytes, readIssue: 'read_failed' };
  } finally { reader?.releaseLock(); }
}

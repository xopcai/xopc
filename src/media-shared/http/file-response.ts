import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { parseByteRange } from './byte-range.js';

export function toFileWebStream(stream: Readable): ReadableStream<Uint8Array<ArrayBuffer>> {
  return Readable.toWeb(stream, {
    strategy: { highWaterMark: stream.readableHighWaterMark, size: (chunk: Uint8Array) => chunk.byteLength },
  }) as ReadableStream<Uint8Array<ArrayBuffer>>;
}

export function fileRangeResponse(path: string, size: number, rangeHeader: string | undefined,
  headers: Headers | Record<string, string>, headOnly = false): Response {
  const responseHeaders = new Headers(headers);
  const range = parseByteRange(rangeHeader, size);
  responseHeaders.set('Accept-Ranges', 'bytes');
  if (range === 'invalid') {
    responseHeaders.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers: responseHeaders });
  }
  if (range) responseHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  responseHeaders.set('Content-Length', String(range ? range.end - range.start + 1 : size));
  const stream = headOnly ? null : toFileWebStream(createReadStream(path, range ?? undefined));
  return new Response(stream, { status: range ? 206 : 200, headers: responseHeaders });
}

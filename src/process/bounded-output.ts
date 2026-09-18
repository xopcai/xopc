export interface BoundedOutput {
  readonly text: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

/** Keeps the newest bytes so failures retain their most useful tail output. */
export function createBoundedOutput(maxBytes: number): {
  append(chunk: Buffer | string): void;
  snapshot(): BoundedOutput;
} {
  const limit = Math.max(0, Math.floor(maxBytes));
  let chunks: Buffer[] = [];
  let capturedBytes = 0;
  let totalBytes = 0;

  return {
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += value.byteLength;
      if (limit === 0) {
        chunks = [];
        capturedBytes = 0;
        return;
      }
      chunks.push(value);
      capturedBytes += value.byteLength;
      while (capturedBytes > limit && chunks.length > 0) {
        const excess = capturedBytes - limit;
        const first = chunks[0]!;
        if (first.byteLength <= excess) {
          chunks.shift();
          capturedBytes -= first.byteLength;
        } else {
          chunks[0] = first.subarray(excess);
          capturedBytes -= excess;
        }
      }
    },
    snapshot() {
      return {
        text: Buffer.concat(chunks, capturedBytes).toString('utf8'),
        totalBytes,
        truncated: totalBytes > capturedBytes,
      };
    },
  };
}

import { timingSafeEqual } from 'node:crypto';

/**
 * Pad a Buffer to the target length by allocating a zeroed buffer and copying.
 */
function padSecretBytes(bytes: Buffer, length: number): Buffer {
  if (bytes.length === length) {
    return bytes;
  }
  const padded = Buffer.alloc(length);
  bytes.copy(padded);
  return padded;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses `crypto.timingSafeEqual` with padding so both buffers always have
 * the same byte length. The actual length is checked separately to reject
 * mismatches without leaking position information.
 */
export function safeEqualSecret(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const byteLength = Math.max(providedBytes.length, expectedBytes.length);
  if (byteLength === 0) {
    return true;
  }
  return (
    timingSafeEqual(
      padSecretBytes(providedBytes, byteLength),
      padSecretBytes(expectedBytes, byteLength),
    ) && providedBytes.length === expectedBytes.length
  );
}

export const SESSION_INPUT_RETRY_DELAYS_MS = [0, 500, 1_500] as const;
export const SESSION_INPUT_REQUEST_TIMEOUT_MS = 10_000;

export function sessionInputFingerprint(input: {
  content: string;
  thinking?: string;
  attachments?: unknown[];
}): string {
  const serialized = JSON.stringify([
    input.content,
    input.thinking ?? null,
    input.attachments ?? null,
  ]);
  let fnvHash = 2166136261;
  let djbHash = 5381;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    fnvHash ^= code;
    fnvHash = Math.imul(fnvHash, 16777619);
    djbHash = Math.imul(djbHash, 33) ^ code;
  }
  return `${serialized.length.toString(36)}:${(fnvHash >>> 0).toString(36)}:${(djbHash >>> 0).toString(36)}`;
}

export function shouldRetrySessionInputStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

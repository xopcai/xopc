/** Fallback mask when the real secret length is unknown (e.g. env-sourced keys). */
export const GENERIC_MASKED_SECRET = '••••••••••••';

/** Length-preserving mask for secrets returned to the web console. */
export function maskSecretLength(secret: string): string {
  const trimmed = secret.trim();
  return trimmed ? '•'.repeat(trimmed.length) : '';
}

/** True when a PATCH body carries a masked sentinel instead of a new secret. */
export function isMaskedSecretPatchValue(value: string): boolean {
  return value === '***' || value === GENERIC_MASKED_SECRET || /^•+$/.test(value);
}

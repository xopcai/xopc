/** True for gateway masked secret sentinels (`***`, bullet placeholder, or length-preserving `•` runs). */
export function isMaskedSecret(value: string): boolean {
  return value === '***' || value === '••••••••••••' || /^•+$/.test(value);
}

/** Display value for a concealed secret (password input shows one dot per character). */
export function concealedSecretDisplay(length: number): string {
  return length > 0 ? '•'.repeat(length) : '';
}

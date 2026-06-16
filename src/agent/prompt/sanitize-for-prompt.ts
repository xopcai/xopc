/**
 * Sanitize untrusted strings before embedding them into an LLM prompt.
 *
 * Strips control/format characters that could break prompt structure or inject instructions.
 */
export function sanitizeForPromptLiteral(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '');
}

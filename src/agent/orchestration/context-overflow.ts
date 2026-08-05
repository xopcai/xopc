const CONTEXT_OVERFLOW_PATTERNS = [
  /context(?:_|\s|-)*(?:length|window).*(?:exceed|limit|maximum|too (?:large|long))/i,
  /maximum context length/i,
  /max(?:imum)? tokens?.*(?:exceed|limit)/i,
  /too many tokens/i,
  /prompt (?:is )?too (?:large|long)/i,
  /request (?:is )?too large/i,
  /input (?:is )?too (?:large|long)/i,
  /input token count.*exceed/i,
  /reduce (?:the )?(?:length|size) of (?:the )?(?:messages|prompt|input)/i,
  /token limit exceeded/i,
];

export function isContextOverflowError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

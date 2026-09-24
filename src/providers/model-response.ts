const TRANSIENT_PROVIDER_ERROR_SUBSTRINGS = [
  'fetch failed',
  'econnreset',
  'econnrefused',
  'enotfound',
  'socket hang up',
  'getaddrinfo',
  'networkerror',
  'etimedout',
  'certificate',
  'ssl',
  'tls',
  'provider_error',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
];

/** Extract visible text from a provider assistant message. */
export function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const text: string[] = [];
  const thinking: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const value = block as Record<string, unknown>;
    if (value.type === 'text' && typeof value.text === 'string') text.push(value.text);
    if (value.type === 'thinking') {
      const part = typeof value.thinking === 'string' ? value.thinking : value.text;
      if (typeof part === 'string') thinking.push(part);
    }
  }
  return text.join('').trim() || thinking.join('').trim();
}

/** True when retrying a model request may recover from a transport or upstream 5xx failure. */
export function isTransientProviderErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_PROVIDER_ERROR_SUBSTRINGS.some((value) => lower.includes(value))
    || /(?:^|\D)(?:500|502|503|504)(?:\D|$)/.test(lower);
}

export function stripCodeFences(raw: string): string {
  return raw.trim().replace(/^`{3,}[^\n]*\n?/, '').replace(/\n?`{3,}\s*$/, '').trim();
}

export function getAssistantMessageErrorReason(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const value = message as Record<string, unknown>;
  if (value.stopReason !== 'error') return null;
  return typeof value.errorMessage === 'string' && value.errorMessage.trim()
    ? value.errorMessage.trim()
    : 'Model call failed.';
}

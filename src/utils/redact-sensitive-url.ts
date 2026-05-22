/** Redact credentials and sensitive query params from URLs for logs. */
export function redactSensitiveUrl(url: string): string {
  return redactSensitiveUrlLikeString(url);
}

export function redactSensitiveUrlLikeString(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase().replaceAll('-', '_');
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('api_key') ||
        lower === 'key' ||
        lower === 'auth'
      ) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return value.replace(/(token|secret|password|api[_-]?key)=[^&\s]+/gi, '$1=***');
  }
}

export type McpConnectionErrorCode = 'command_missing' | 'connection_refused' | 'host_not_found' | 'timeout'
  | 'access_denied' | 'network' | 'tls' | 'invalid_response' | 'not_found' | 'rate_limited' | 'configuration' | 'unknown';

/** Return a safe category without exposing addresses, headers, or credential-bearing errors. */
export function classifyMcpConnectionError(error: unknown): McpConnectionErrorCode {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && seen.size < 8) {
    seen.add(current);
    if (typeof current !== 'object') { messages.push(String(current)); break; }
    const detail = current as { message?: unknown; code?: unknown; cause?: unknown };
    messages.push(String(detail.message ?? ''), String(detail.code ?? ''));
    current = detail.cause;
  }
  const message = messages.join(' ');
  if (/ENOENT|command not found|executable.{0,30}not found/i.test(message)) return 'command_missing';
  if (/ECONNREFUSED|connection refused/i.test(message)) return 'connection_refused';
  if (/ENOTFOUND|EAI_AGAIN|could not resolve/i.test(message)) return 'host_not_found';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return 'timeout';
  if (/CERT_|CERTIFICATE|ERR_TLS|UNABLE_TO_VERIFY|DEPTH_ZERO|self.signed|unable to verify/i.test(message)) return 'tls';
  if (/\b429\b|too many requests|rate.limit/i.test(message)) return 'rate_limited';
  if (/\b(?:401|403)\b|unauthorized|forbidden|permission denied|invalid_token/i.test(message)) return 'access_denied';
  if (/\b404\b|\b405\b|method not allowed/i.test(message)) return 'not_found';
  if (/ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed|network error|socket.*closed/i.test(message)) return 'network';
  if (/content.type|text\/html|invalid json|unexpected token|protocol version|not a valid JSON/i.test(message)) return 'invalid_response';
  if (/not configured|invalid configuration|is disabled/i.test(message)) return 'configuration';
  return 'unknown';
}

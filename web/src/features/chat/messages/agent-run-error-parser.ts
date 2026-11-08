import type { ProviderSetupPayload } from '@/features/chat/messages/provider-setup-required.types';

export type AgentRunErrorKind =
  | 'provider_setup_required'
  | 'provider_auth_invalid'
  | 'rate_limit'
  | 'timeout'
  | 'provider_connection_error'
  | 'billing'
  | 'xopc_quota_exhausted'
  | 'xopc_platform_limit'
  | 'xopc_credit_budget_exhausted'
  | 'session_not_found'
  | 'unknown'
  | 'send_failed';

export type AgentRunErrorPayload = {
  kind: AgentRunErrorKind;
  code: string;
  provider?: string;
  modelRef?: string;
  deepLink?: string;
  message: string;
};

const PLAIN_TEXT_API_KEY_RE = /^No API key found for (\S+)/i;

/** Keep credentials out of user-visible diagnostics and copied reports. */
export function safeErrorDetail(message: string): string {
  return message
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/((?:access_token|refresh_token|api_key|client_secret|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[redacted]');
}

function parseStructuredJson(text: string): AgentRunErrorPayload | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.kind !== 'string' || typeof parsed.message !== 'string') return null;
    return {
      kind: parsed.kind as AgentRunErrorKind,
      code: typeof parsed.code === 'string' ? parsed.code : parsed.kind,
      provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
      modelRef: typeof parsed.modelRef === 'string' ? parsed.modelRef : undefined,
      deepLink: typeof parsed.deepLink === 'string' ? parsed.deepLink : undefined,
      message: parsed.message,
    };
  } catch {
    return null;
  }
}

export function buildSendFailedErrorPayload(): AgentRunErrorPayload {
  return {
    kind: 'send_failed',
    code: 'send_failed',
    message: 'Send failed',
  };
}

export function buildSessionNotFoundErrorPayload(message: string): AgentRunErrorPayload {
  return {
    kind: 'session_not_found',
    code: 'session_not_found',
    message,
  };
}

export function parseAgentRunError(text: string): AgentRunErrorPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    const structured = parseStructuredJson(trimmed);
    if (structured) return structured;
  }

  const missingMatch = PLAIN_TEXT_API_KEY_RE.exec(trimmed);
  if (missingMatch) {
    const provider = missingMatch[1].replace(/[.,]$/, '');
    return {
      kind: 'provider_setup_required',
      code: 'provider_setup_required',
      provider,
      deepLink: '/settings/capabilities/models',
      message: trimmed,
    };
  }

  const provider = /OAuth refresh failed for ([\w-]+)/i.exec(trimmed)?.[1];
  const code = /invalid_grant|invalid.api.key|unauthorized|token.*revoked|\b401\b/i.test(trimmed)
    ? 'provider_auth_invalid'
    : /insufficient_quota|billing|credit.balance|payment.required/i.test(trimmed) ? 'billing'
      : /429|rate.limit|too many requests/i.test(trimmed) ? 'rate_limit'
        : /timed?\s*out|timeout|\b408\b|\b504\b/i.test(trimmed) ? 'timeout'
          : /fetch failed|connection error|econn|network|socket|\b50[023]\b|service unavailable/i.test(trimmed)
            ? 'provider_connection_error' : undefined;
  if (code) return { kind: code, code, provider, message: trimmed };

  if (trimmed === 'Assistant turn failed' || trimmed.startsWith('Error: ')) {
    return {
      kind: 'unknown',
      code: 'unknown',
      message: trimmed.startsWith('Error: ') ? trimmed.slice('Error: '.length) : trimmed,
    };
  }

  return {
    kind: 'unknown',
    code: 'unknown',
    message: trimmed,
  };
}

export function toProviderSetupPayload(payload: AgentRunErrorPayload): ProviderSetupPayload | null {
  if (
    (payload.kind !== 'provider_setup_required' && payload.kind !== 'provider_auth_invalid')
    || !payload.provider
  ) return null;
  return {
    kind: payload.kind,
    provider: payload.provider,
    deepLink: payload.deepLink ?? '/settings/capabilities/models',
    message: payload.message,
  };
}

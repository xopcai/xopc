import type { ProviderSetupPayload } from '@/features/chat/messages/provider-setup-required-banner';

export type AgentRunErrorKind =
  | 'provider_setup_required'
  | 'provider_auth_invalid'
  | 'rate_limit'
  | 'timeout'
  | 'billing'
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
      deepLink: '/settings/credentials',
      message: trimmed,
    };
  }

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
  if (payload.kind !== 'provider_setup_required' || !payload.provider) return null;
  return {
    kind: 'provider_setup_required',
    provider: payload.provider,
    deepLink: '/settings/credentials',
    message: payload.message,
  };
}

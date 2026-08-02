import {
  classifyFailoverReason,
  isAuthErrorMessage,
  type FailoverReason,
} from './fallback/reason.js';

export type AgentRunErrorKind =
  | 'provider_setup_required'
  | 'provider_auth_invalid'
  | 'rate_limit'
  | 'timeout'
  | 'billing'
  | 'unknown';

export type AgentRunErrorPayload = {
  kind: AgentRunErrorKind;
  code: string;
  provider?: string;
  modelRef?: string;
  deepLink?: string;
  message: string;
};

const API_KEY_MISSING_RE = /^No API key found for (\S+)/i;

function reasonToKind(reason: FailoverReason): AgentRunErrorKind {
  switch (reason) {
    case 'auth':
      return 'provider_auth_invalid';
    case 'rate_limit':
      return 'rate_limit';
    case 'timeout':
      return 'timeout';
    case 'billing':
      return 'billing';
    default:
      return 'unknown';
  }
}

function reasonToCode(reason: FailoverReason): string {
  switch (reason) {
    case 'auth':
      return 'provider_auth_invalid';
    case 'rate_limit':
      return 'rate_limit';
    case 'timeout':
      return 'timeout';
    case 'billing':
      return 'billing';
    case 'format':
      return 'format';
    default:
      return 'unknown';
  }
}

function providerDeepLink(kind: AgentRunErrorKind): string | undefined {
  if (kind === 'provider_setup_required' || kind === 'provider_auth_invalid') {
    return '/settings/capabilities/models';
  }
  return undefined;
}

function tryParseStructuredPayload(text: string): AgentRunErrorPayload | null {
  if (!text.startsWith('{')) return null;
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

/**
 * Map a raw agent/LLM error into a structured JSON payload the web UI can render
 * as an actionable, i18n-friendly card. Falls back to plain `Error: <raw>` when
 * the input is already a legacy gateway string.
 */
export function formatAgentRunErrorForClient(
  rawError: string,
  context?: { provider?: string; modelRef?: string },
): string {
  const trimmed = rawError.trim();
  if (!trimmed) {
    return JSON.stringify({
      kind: 'unknown',
      code: 'unknown',
      message: 'Assistant turn failed',
    } satisfies AgentRunErrorPayload);
  }

  const existing = tryParseStructuredPayload(trimmed);
  if (existing) return JSON.stringify(existing);

  const missingMatch = API_KEY_MISSING_RE.exec(trimmed);
  if (missingMatch) {
    const provider = missingMatch[1].replace(/\.$/, '');
    return JSON.stringify({
      kind: 'provider_setup_required',
      code: 'provider_setup_required',
      provider,
      deepLink: '/settings/capabilities/models',
      message: trimmed,
    } satisfies AgentRunErrorPayload);
  }

  const reason = classifyFailoverReason(trimmed);
  const kind = reasonToKind(reason);
  const payload: AgentRunErrorPayload = {
    kind,
    code: reasonToCode(reason),
    message: trimmed,
    ...(context?.provider ? { provider: context.provider } : {}),
    ...(context?.modelRef ? { modelRef: context.modelRef } : {}),
  };

  const deepLink = providerDeepLink(kind);
  if (deepLink) payload.deepLink = deepLink;

  // Auth heuristics that classifyFailoverReason may miss (e.g. "Authentication Fails")
  if (kind === 'unknown' && isAuthErrorMessage(trimmed)) {
    payload.kind = 'provider_auth_invalid';
    payload.code = 'provider_auth_invalid';
    payload.deepLink = '/settings/capabilities/models';
  }

  return JSON.stringify(payload);
}

/** Human-readable text for TUI/CLI when SSE carries structured JSON. */
export function formatAgentRunErrorForDisplay(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('Error: ')) return trimmed.slice('Error: '.length);

  const parsed = tryParseStructuredPayload(trimmed);
  if (parsed?.message) return parsed.message;

  return trimmed;
}

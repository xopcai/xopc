export type MobileAgentRunErrorPayload = {
  kind: string;
  code: string;
  provider?: string;
  modelRef?: string;
  message: string;
};

type MobileAgentRunErrorMessages = {
  modelQuotaExhausted: string;
  platformTokenLimitExceeded: string;
};

function parseJsonValue(text: string): unknown {
  let value: unknown = text;
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
    const candidate = value.trim().replace(/^Error:\s*/i, '');
    if (!candidate.startsWith('{') && !candidate.startsWith('"')) return null;
    try {
      value = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

/** Parse the structured error envelope emitted by the gateway agent stream. */
export function parseMobileAgentRunError(text: string): MobileAgentRunErrorPayload | null {
  const parsed = parseJsonValue(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.message !== 'string') return null;

  const kind = typeof payload.kind === 'string' ? payload.kind : '';
  const code = typeof payload.code === 'string' ? payload.code : kind;
  if (!kind && !code) return null;

  return {
    kind: kind || code,
    code: code || kind,
    provider: typeof payload.provider === 'string' ? payload.provider : undefined,
    modelRef: typeof payload.modelRef === 'string' ? payload.modelRef : undefined,
    message: payload.message,
  };
}

/** Keep protocol JSON out of the mobile toast and map recoverable limits to local copy. */
export function formatMobileAgentRunError(
  text: string,
  messages: MobileAgentRunErrorMessages,
): string {
  const payload = parseMobileAgentRunError(text);
  if (!payload) return text.trim().replace(/^Error:\s*/i, '');

  switch (payload.code) {
    case 'model_quota_exhausted':
      return messages.modelQuotaExhausted;
    case 'platform_token_limit_exceeded':
      return messages.platformTokenLimitExceeded;
    default:
      return payload.message;
  }
}

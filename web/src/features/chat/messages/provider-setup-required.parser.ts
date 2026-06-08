import type { ProviderSetupPayload } from '@/features/chat/messages/provider-setup-required.types';

/**
 * Detect provider-setup-required errors in two forms:
 * 1. Structured JSON from gateway catch path: `{"kind":"provider_setup_required",...}`
 * 2. Plain text from upstream pi-coding-agent assistant output: "No API key found for <provider>..."
 */
const PLAIN_TEXT_API_KEY_RE = /^No API key found for (\S+)/i;

export function parseProviderSetupRequired(text: string): ProviderSetupPayload | null {
  const trimmed = text.trim();

  // 1. Structured JSON (from gateway error event)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.kind !== 'provider_setup_required') return null;
      if (typeof parsed.provider !== 'string' || !parsed.provider) return null;
      if (typeof parsed.deepLink !== 'string' || !parsed.deepLink.startsWith('/settings/')) return null;
      return {
        kind: 'provider_setup_required',
        provider: parsed.provider,
        deepLink: parsed.deepLink,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
      };
    } catch {
      return null;
    }
  }

  // 2. Plain text (from upstream pi-coding-agent assistant message)
  const match = PLAIN_TEXT_API_KEY_RE.exec(trimmed);
  if (match) {
    const provider = match[1].replace(/[.,]$/, '');
    return {
      kind: 'provider_setup_required',
      provider,
      deepLink: '/settings/credentials',
      message: trimmed,
    };
  }

  return null;
}

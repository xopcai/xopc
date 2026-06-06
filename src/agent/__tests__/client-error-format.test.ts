import { describe, it, expect } from 'vitest';

import {
  formatAgentRunErrorForClient,
  formatAgentRunErrorForDisplay,
} from '../client-error-format.js';

describe('formatAgentRunErrorForClient', () => {
  it('maps missing API key to provider_setup_required', () => {
    const raw = 'No API key found for dashscope.';
    const out = JSON.parse(formatAgentRunErrorForClient(raw)) as { kind: string; provider: string };
    expect(out.kind).toBe('provider_setup_required');
    expect(out.provider).toBe('dashscope');
  });

  it('maps 401 invalid api key to provider_auth_invalid', () => {
    const raw = '401 Authentication Fails, Your api key: ****0000 is invalid';
    const out = JSON.parse(
      formatAgentRunErrorForClient(raw, { provider: 'dashscope' }),
    ) as { kind: string; code: string; provider: string; deepLink: string };
    expect(out.kind).toBe('provider_auth_invalid');
    expect(out.code).toBe('provider_auth_invalid');
    expect(out.provider).toBe('dashscope');
    expect(out.deepLink).toBe('/settings/credentials');
  });

  it('maps rate limit errors', () => {
    const raw = 'Rate limit exceeded for model';
    const out = JSON.parse(formatAgentRunErrorForClient(raw)) as { kind: string; code: string };
    expect(out.kind).toBe('rate_limit');
    expect(out.code).toBe('rate_limit');
  });

  it('passes through already-structured payloads', () => {
    const existing = JSON.stringify({
      kind: 'provider_setup_required',
      code: 'provider_setup_required',
      provider: 'openai',
      deepLink: '/settings/credentials',
      message: 'No API key found for openai',
    });
    expect(formatAgentRunErrorForClient(existing)).toBe(existing);
  });
});

describe('formatAgentRunErrorForDisplay', () => {
  it('extracts message from structured JSON', () => {
    const payload = JSON.stringify({
      kind: 'provider_auth_invalid',
      code: 'provider_auth_invalid',
      message: '401 Authentication Fails',
    });
    expect(formatAgentRunErrorForDisplay(payload)).toBe('401 Authentication Fails');
  });

  it('strips legacy Error: prefix', () => {
    expect(formatAgentRunErrorForDisplay('Error: something broke')).toBe('something broke');
  });
});

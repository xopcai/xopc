import { describe, it, expect } from 'vitest';

import { parseAgentRunError } from '../agent-run-error-parser';

describe('parseAgentRunError', () => {
  it('parses provider_auth_invalid structured payload', () => {
    const text = JSON.stringify({
      kind: 'provider_auth_invalid',
      code: 'provider_auth_invalid',
      provider: 'dashscope',
      deepLink: '/settings/credentials',
      message: '401 Authentication Fails, Your api key: ****0000 is invalid',
    });
    const parsed = parseAgentRunError(text);
    expect(parsed?.code).toBe('provider_auth_invalid');
    expect(parsed?.provider).toBe('dashscope');
    expect(parsed?.message).toContain('401 Authentication Fails');
  });

  it('parses plain missing API key text', () => {
    const parsed = parseAgentRunError('No API key found for openai');
    expect(parsed?.kind).toBe('provider_setup_required');
    expect(parsed?.provider).toBe('openai');
  });

  it('maps legacy assistant turn failed to unknown', () => {
    const parsed = parseAgentRunError('Assistant turn failed');
    expect(parsed?.code).toBe('unknown');
    expect(parsed?.message).toBe('Assistant turn failed');
  });
});

import { describe, expect, it } from 'vitest';

import { extractAssistantText, isTransientProviderErrorMessage } from '../model-response.js';

describe('extractAssistantText', () => {
  it.each(['Connection error.', 'APIConnectionError: Connection error.', ' CONNECTION ERROR. ',
    '429 Too Many Requests', '408 Request Timeout', 'Stream ended without finish_reason',
    'OpenAI Responses stream ended without a stop reason', 'Anthropic stream ended before message_stop',
    'WebSocket idle timeout after 60000ms', 'terminated'])('allows request recovery for %s', error => {
    expect(isTransientProviderErrorMessage(error)).toBe(true);
  });

  it.each(['429 insufficient_quota', 'usage_limit_reached', 'credit_budget_exhausted', '401 Invalid API key',
    'Connection error: provider_usage_scope_denied', 'Connection error: credit_budget_exhausted'])('does not retry terminal auth or budget failures: %s', error => {
    expect(isTransientProviderErrorMessage(error)).toBe(false);
  });
  it('supports legacy string content', () => {
    expect(extractAssistantText('  answer  ')).toBe('answer');
  });

  it('prefers visible text over thinking content', () => {
    expect(extractAssistantText([
      { type: 'thinking', thinking: 'private reasoning' },
      { type: 'text', text: 'visible answer' },
    ])).toBe('visible answer');
  });

  it('falls back to thinking content when a model returns no text block', () => {
    expect(extractAssistantText([
      { type: 'thinking', thinking: '{"ok":true}' },
    ])).toBe('{"ok":true}');
  });

  it('identifies retryable upstream failures without retrying permanent errors', () => {
    expect(isTransientProviderErrorMessage('502: {"code":"provider_error"}')).toBe(true);
    expect(isTransientProviderErrorMessage('503 Service Unavailable')).toBe(true);
    expect(isTransientProviderErrorMessage('Invalid API key')).toBe(false);
  });
});

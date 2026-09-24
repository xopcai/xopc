import { describe, expect, it } from 'vitest';

import { extractAssistantText, isTransientProviderErrorMessage } from '../model-response.js';

describe('extractAssistantText', () => {
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

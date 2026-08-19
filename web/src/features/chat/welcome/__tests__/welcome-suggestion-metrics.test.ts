// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readWelcomeSuggestionAffinity,
  recordWelcomeSuggestionMetric,
  WELCOME_SUGGESTION_METRIC_EVENT,
} from '@/features/chat/welcome/welcome-suggestion-metrics';

describe('welcome suggestion metrics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores aggregate affinity without storing prompt content', () => {
    recordWelcomeSuggestionMetric({
      type: 'pick',
      suggestionId: 'note-next:0',
      categoryId: 'note-next',
      contextKind: 'note',
    });
    recordWelcomeSuggestionMetric({
      type: 'send',
      suggestionId: 'note-next:0',
      categoryId: 'note-next',
      contextKind: 'note',
      edited: true,
      characterDelta: 12,
    });

    expect(readWelcomeSuggestionAffinity()['note-next:0']).toBe(12);
    expect(localStorage.getItem('xopc:chat-welcome-suggestion-metrics:v1')).not.toContain('prompt');
  });

  it('emits an event that future analytics adapters can consume', () => {
    const listener = vi.fn();
    window.addEventListener(WELCOME_SUGGESTION_METRIC_EVENT, listener);

    recordWelcomeSuggestionMetric({
      type: 'impression',
      suggestionId: 'work:0',
      categoryId: 'work',
      contextKind: 'empty',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(WELCOME_SUGGESTION_METRIC_EVENT, listener);
  });
});

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
      agentId: 'writer',
    });
    recordWelcomeSuggestionMetric({
      type: 'send',
      suggestionId: 'note-next:0',
      categoryId: 'note-next',
      contextKind: 'note',
      agentId: 'writer',
      edited: true,
      characterDelta: 12,
    });

    expect(readWelcomeSuggestionAffinity('note', 'writer')['note-next:0']).toBe(11);
    expect(readWelcomeSuggestionAffinity('empty', 'writer')['note-next:0']).toBeUndefined();
    expect(localStorage.getItem('xopc:chat-welcome-suggestion-metrics:v2')).not.toContain('prompt');
  });

  it('emits an event that future analytics adapters can consume', () => {
    const listener = vi.fn();
    window.addEventListener(WELCOME_SUGGESTION_METRIC_EVENT, listener);

    recordWelcomeSuggestionMetric({
      type: 'impression',
      suggestionId: 'work:0',
      categoryId: 'work',
      contextKind: 'empty',
      agentId: 'main',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(WELCOME_SUGGESTION_METRIC_EVENT, listener);
  });

  it('reduces affinity when an exploration suggestion is skipped', () => {
    for (let index = 0; index < 3; index += 1) {
      recordWelcomeSuggestionMetric({
        type: 'pick', suggestionId: 'explore:0', categoryId: 'explore', contextKind: 'empty', agentId: 'main',
      });
    }
    recordWelcomeSuggestionMetric({
      type: 'skip', suggestionId: 'explore:0', categoryId: 'explore', contextKind: 'empty', agentId: 'main',
    });

    expect(readWelcomeSuggestionAffinity('empty', 'main')['explore:0']).toBe(5);
  });
});

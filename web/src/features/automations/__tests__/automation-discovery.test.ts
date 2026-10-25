import { describe, expect, it } from 'vitest';

import { pickAutomationIdeas } from '../automation-discovery';
import { automationConfigurationHref } from '../automation-create-navigation';

describe('conversation-first task discovery', () => {
  it('offers six unique ideas and can rotate the selection', () => {
    const first = pickAutomationIdeas(() => 0);
    const second = pickAutomationIdeas(() => 0.99);
    expect(first).toHaveLength(6);
    expect(new Set(first.map(idea => idea[1])).size).toBe(6);
    expect(first).not.toEqual(second);
  });

  it.each(['zh', 'en'] as const)('hands each idea to a scoped conversation in %s', language => {
    for (const idea of pickAutomationIdeas(() => 0.5)) {
      const prompt = language === 'zh' ? idea[5] : idea[6];
      const url = new URL(automationConfigurationHref('config-1', prompt), 'https://xopc.local');
      expect(url.pathname).toBe('/chat/config-1');
      expect(url.searchParams.get('setup')).toBe('automation');
      expect(url.searchParams.get('draft')).toBe(prompt);
      expect(url.searchParams.has('autoSend')).toBe(false);
    }
  });

});

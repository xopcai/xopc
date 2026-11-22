import { describe, expect, it } from 'vitest';

import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

import { formatContextualSourceSnippet, matchContextualLocalSource } from '../desktop-contextual-setup';

function availableSource(id: string): ElectronUnderstandingSourceDefinition {
  return {
    id,
    category: 'calendar',
    platform: 'darwin',
    displayName: id,
    description: '',
    availability: 'available',
    permission: 'not_requested',
    defaultAccessMode: 'once',
    supportedAccessModes: ['once'],
    recommended: false,
    sensitive: true,
  };
}

describe('desktop-contextual-setup', () => {
  it('offers Apple Calendar only when intent mentions meetings/schedule and source is available', () => {
    const sources = [availableSource('apple-calendar'), availableSource('apple-mail')];

    const match = matchContextualLocalSource('准备明天下午的产品评审会议', sources, 'zh');
    expect(match?.sourceId).toBe('apple-calendar');
    expect(match?.label).toBe('Apple 日历');

    expect(matchContextualLocalSource('排查登录接口超时问题', sources, 'zh')).toBeNull();
    expect(matchContextualLocalSource('准备明天下午的产品评审会议', [], 'zh')).toBeNull();
  });

  it('matches mail, reminders, and notes contextually in English and Chinese', () => {
    const sources = [
      availableSource('apple-mail'),
      availableSource('apple-reminders'),
      availableSource('apple-notes'),
    ];
    expect(matchContextualLocalSource('Draft reply to customer email', sources, 'en')?.sourceId).toBe('apple-mail');
    expect(matchContextualLocalSource('整理今天未完成的待办清单', sources, 'zh')?.sourceId).toBe('apple-reminders');
    expect(matchContextualLocalSource('把我的备忘录草稿整理成文档', sources, 'zh')?.sourceId).toBe('apple-notes');
  });

  it('formats collected items into a concise bounded context block', () => {
    const snippet = formatContextualSourceSnippet(
      'Apple 日历',
      [
        {
          id: 'evt-1',
          sourceId: 'apple-calendar',
          type: 'calendar_event',
          title: 'Q4 产品评审',
          text: '讨论 onboarding 改造和核心指标',
          startsAt: Date.UTC(2026, 10, 23, 6, 0),
          ownerAttribution: 'unknown',
          sensitivity: 'personal',
          evidenceRef: 'apple-calendar://evt-1',
        },
      ],
      'zh',
    );
    expect(snippet).toContain('【已附带的本地参考：Apple 日历】');
    expect(snippet).toContain('Q4 产品评审');
    expect(snippet).toContain('讨论 onboarding 改造和核心指标');
  });
});

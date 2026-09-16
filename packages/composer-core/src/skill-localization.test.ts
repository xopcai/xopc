import { describe, expect, it } from 'vitest';

import { resolveSkillPresentation } from './skill-localization.js';

const skill = {
  name: 'meeting-to-actions',
  description: 'Convert meeting notes into actions.',
  localizations: {
    en: { displayName: 'Meeting to Actions', description: 'Convert meeting notes into actions.' },
    'zh-CN': { displayName: '会议行动闭环', description: '从会议记录中提取行动项。' },
  },
} as const;

describe('resolveSkillPresentation', () => {
  it('uses Chinese presentation while retaining searchable canonical and English aliases', () => {
    expect(resolveSkillPresentation(skill, 'zh')).toEqual({
      displayName: '会议行动闭环',
      description: '从会议记录中提取行动项。',
      aliases: ['meeting-to-actions', 'Meeting to Actions'],
    });
  });

  it('falls back to canonical skill metadata when localizations are absent', () => {
    expect(resolveSkillPresentation({ name: 'review', description: 'Review code.' }, 'zh-CN')).toEqual({
      displayName: 'review',
      description: 'Review code.',
      aliases: [],
    });
  });
});

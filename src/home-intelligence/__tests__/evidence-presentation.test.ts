import { describe, expect, it } from 'vitest';

import { buildEvidencePresentation } from '../evidence-presentation.js';

const evidence = ['one', 'two'].map((id) => ({
  id, sourceType: 'user_model' as const, sourceRef: id, revision: '1',
  observation: 'Source documents conflict on publishing intent.', observedAt: 1, freshUntil: 100,
}));
const groups = [{ summary: '发布口径存在冲突，尚未确认。', evidenceIds: ['one', 'two'] }];

describe('home evidence presentation', () => {
  it('groups records while preserving both original observations and references', () => {
    expect(buildEvidencePresentation(groups, ['one', 'two'], evidence, 'zh'))
      .toEqual({ version: 1, locale: 'zh', groups });
    expect(evidence.map((item) => item.observation)).toEqual([
      'Source documents conflict on publishing intent.', 'Source documents conflict on publishing intent.',
    ]);
  });

  it.each([
    [{ summary: '口径冲突。', evidenceIds: ['one'] }],
    [{ summary: '口径冲突。', evidenceIds: ['one', 'two', 'invented'] }],
    [{ summary: '口径冲突。', evidenceIds: ['one', 'two', 'two'] }],
    [{ summary: '口径冲突。', evidenceIds: ['one', 'two'] }, { summary: '仍待确认。', evidenceIds: ['two'] }],
    [{ summary: 'Source documents conflict on whether 拾光 should be published externally.', evidenceIds: ['one', 'two'] }],
    [{ summary: '`Source documents conflict on publishing intent`', evidenceIds: ['one', 'two'] }],
    [{ summary: '<b>发布口径冲突。</b>', evidenceIds: ['one', 'two'] }],
    [{ summary: '', evidenceIds: ['one', 'two'] }],
  ])('rejects incomplete, repeated, invented or unlocalized display groups: %j', (...invalidGroups) => {
    expect(buildEvidencePresentation(invalidGroups, ['one', 'two'], evidence, 'zh')).toBeUndefined();
  });

  it('rejects a projection after any candidate evidence was filtered out', () => {
    expect(buildEvidencePresentation(groups, ['one', 'two'], evidence.slice(0, 1), 'zh')).toBeUndefined();
    expect(buildEvidencePresentation([{ summary: '口径待确认。', evidenceIds: ['one'] }],
      ['one', 'expired'], evidence.slice(0, 1), 'zh')).toBeUndefined();
  });

  it('accepts Chinese summaries with filenames, identifiers and source uncertainty', () => {
    const summary = '已生成拾光-发布页.html 和宣传卡 PNG；仅写入 `/Users/demo/release`，尚未对外发布。';
    expect(buildEvidencePresentation([{ summary, evidenceIds: ['one', 'two'] }],
      ['one', 'two'], evidence, 'zh')?.groups[0].summary).toBe(summary);
    expect(buildEvidencePresentation([{ summary: 'Publishing intent remains unresolved.', evidenceIds: ['one', 'two'] }],
      ['one', 'two'], evidence, 'en')?.locale).toBe('en');
    expect(buildEvidencePresentation(groups, ['one', 'two'], evidence, 'en')).toBeUndefined();
  });
});

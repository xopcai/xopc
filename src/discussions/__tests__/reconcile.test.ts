import { expect, it } from 'vitest';
import { reconcileMeetingChapters } from '../reconcile.js';
import { normalizeDiscussionOrganization } from '../analyzer.js';

const chapter = (id: string, text: string) => {
  const result = normalizeDiscussionOrganization({ title: 'Meeting', summary: text, decisions: [{ text, evidenceSegmentIds: [0] }] });
  result.decisions[0]!.id = id;
  return result;
};
it('keeps chronological supersession and rejects invented relation targets', async () => {
  const chapters = [chapter('friday', 'Release Friday'), chapter('monday', 'Cancel Friday; release Monday')];
  expect(await reconcileMeetingChapters(chapters, async () => [{ fromId: 'friday', toId: 'monday', relation: 'supersedes' }])).toEqual([{ fromId: 'friday', toId: 'monday', relation: 'supersedes' }]);
  await expect(reconcileMeetingChapters(chapters, async () => [{ fromId: 'monday', toId: 'unknown', relation: 'supersedes' }])).rejects.toThrow('invalid or unordered');
});

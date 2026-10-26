import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/clarification-v2.json';
import { clarifyToolInputV2Schema, normalizeClarificationQuestion, normalizeClarificationSubmission } from './clarifications.js';

const batch = { ...clarifyToolInputV2Schema.parse(fixture), question: 'Publish content' };
const answers = [{ questionId: 'channel', choiceId: 'blog', text: '  Include diagrams  ' }, { questionId: 'frequency', choiceId: 'weekly' }, { questionId: 'direction', text: 'Engineering notes' }];
describe('multi-question clarification contract', () => {
  it('normalizes by stored IDs and question order, preserving custom text', () => {
    const a = normalizeClarificationSubmission(batch, { schemaVersion: 2, answers });
    const b = normalizeClarificationSubmission(batch, { schemaVersion: 2, answers: [...answers].reverse() });
    expect(a).toEqual(b);
    expect(a.answers?.[0]).toEqual({ questionId: 'channel', choiceId: 'blog', text: 'Include diagrams' });
    expect(a.answer).toContain('Channel: Where should we publish?\nBlog\nInclude diagrams');
  });
  it('rejects partial, duplicate, unknown and legacy submissions', () => {
    for (const invalid of [
      { response: { text: 'Everything' } }, { schemaVersion: 2, answers: answers.slice(1) },
      { schemaVersion: 2, answers: [answers[0], answers[0], answers[2]] },
      { schemaVersion: 2, answers: [answers[0], answers[1], { questionId: 'other', text: 'x' }] },
      { schemaVersion: 2, answers: [answers[0], answers[1], { questionId: 'direction', choiceId: 'blog' }] },
      { schemaVersion: 2, answers: [{ questionId: 'channel', choiceId: 'unknown' }, ...answers.slice(1)] },
    ]) expect(() => normalizeClarificationSubmission(batch, invalid)).toThrow();
  });
  it('enforces catalog bounds, unique question IDs and approval separation', () => {
    expect(() => clarifyToolInputV2Schema.parse({ ...fixture, questions: [...fixture.questions, fixture.questions[0]] })).toThrow();
    expect(() => clarifyToolInputV2Schema.parse({ ...fixture, questions: [fixture.questions[0], fixture.questions[0]] })).toThrow();
    expect(() => normalizeClarificationQuestion({ ...batch, kind: 'approval' })).toThrow();
    expect(() => normalizeClarificationSubmission(batch, { schemaVersion: 2, answers: [...answers.slice(0, 2), { questionId: 'direction', text: 'x'.repeat(2001) }] })).toThrow();
  });
});

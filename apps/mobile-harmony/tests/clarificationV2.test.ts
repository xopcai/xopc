import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validClarificationQuestions, validClarificationAnswers } from '../entry/src/main/ets/model/clarification.ets';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/gateway-contract/fixtures/clarification-v2.json', import.meta.url), 'utf8'));
const prompt = { ...fixture, id: 'batch', conversationId: 'conversation', version: 4, kind: 'input', status: 'open', question: 'Three questions' };
const answers = [{ questionId: 'channel', choiceId: 'blog' }, { questionId: 'frequency', choiceId: 'weekly' }, { questionId: 'direction', text: 'Engineering notes\n中文' }];
describe('shared clarification v2 contract', () => {
  it('accepts the shared fixture and validates all answers together', () => {
    expect(validClarificationQuestions(prompt)).toBe(true);
    expect(prompt.questions.map((q: { id: string }) => q.id)).toEqual(['channel', 'frequency', 'direction']);
    expect(validClarificationAnswers(prompt, answers)).toBe(true);
    expect(validClarificationAnswers(prompt, answers.toReversed())).toBe(true);
  });
  it('does not treat recommendations as answers', () => {
    expect(prompt.questions[0].recommendedChoiceId).toBe('blog');
    expect(validClarificationAnswers(prompt, [])).toBe(false);
    expect(validClarificationAnswers(prompt, answers.slice(1))).toBe(false);
  });
  it('rejects duplicate, unknown and invalid choice identities', () => {
    expect(validClarificationAnswers(prompt, [answers[0], answers[0], answers[2]])).toBe(false);
    expect(validClarificationAnswers(prompt, [answers[0], answers[1], { questionId: 'other', text: 'Custom' }])).toBe(false);
    expect(validClarificationAnswers(prompt, [{ questionId: 'channel', choiceId: 'unknown' }, ...answers.slice(1)])).toBe(false);
    expect(validClarificationAnswers(prompt, [answers[0], answers[1], { questionId: 'direction', choiceId: 'blog' }])).toBe(false);
  });
  it('accepts custom choice answers but rejects oversized and empty text', () => {
    expect(validClarificationAnswers(prompt, [{ questionId: 'channel', text: 'Custom' }, ...answers.slice(1)])).toBe(true);
    expect(validClarificationAnswers(prompt, [answers[0], answers[1], { questionId: 'direction', text: ' '.repeat(4) }])).toBe(false);
    expect(validClarificationAnswers(prompt, [answers[0], answers[1], { questionId: 'direction', text: 'x'.repeat(2001) }])).toBe(false);
  });
  it('bounds the complete summary including question text', () => {
    const long = { ...prompt, questions: prompt.questions.map((question: { id: string }) => ({ ...question, question: 'x'.repeat(1000) })) };
    expect(validClarificationAnswers(long, long.questions.map((q: { id: string }) => ({ questionId: q.id, text: 'y'.repeat(2000) })))).toBe(false);
  });

});

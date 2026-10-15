import { describe, expect, it } from 'vitest';
import {
  normalizeClarificationQuestion, normalizeClarificationSubmission,
} from '../src/clarifications.js';

const question = normalizeClarificationQuestion({
  interactionMode: 'compose' as const,
  choiceDetails: [{ id: 'stage', label: 'Staging', description: 'For testing' }, { id: 'prod', label: 'Production' }],
  recommendedChoiceId: 'stage',
});
describe('clarification compatibility and normalization', () => {
  it('accepts only structured questions and answers', () => {
    expect(question.choiceDetails.map(choice => choice.id)).toEqual(['stage', 'prod']);
    expect(() => normalizeClarificationQuestion({ choices: ['A', 'B'] })).toThrow();
    expect(() => normalizeClarificationSubmission(question, { answer: 'Something else' })).toThrow();
  });
  it('preserves structured answers and line breaks, using host-owned labels', () => {
    expect(normalizeClarificationSubmission(question, { response: { choiceId: 'prod', text: ' After 22:00\nVerify first ' } })).toEqual({
      answer: 'Choice: Production\nAdditional information: After 22:00\nVerify first',
      response: { choiceId: 'prod', text: 'After 22:00\nVerify first' },
    });
    expect(normalizeClarificationSubmission(question, { response: { choiceId: 'prod' } }).answer).toBe('Production');
    expect(normalizeClarificationSubmission(question, { response: { text: 'Custom' } }).answer).toBe('Custom');
  });
  it.each([
    { response: { choiceId: 'missing' } }, { response: {} }, { response: { text: ' ' } },
    { response: { choiceId: 'prod', label: 'Injected' } }, { decision: 'approve' },
    { answer: 'Different', response: { choiceId: 'prod' } }, { answer: 'a'.repeat(8001) },
  ])('rejects malformed answers %j', input => {
    expect(() => normalizeClarificationSubmission(question, input)).toThrow();
  });
  it('rejects inconsistent request IDs, labels and recommendations', () => {
    expect(() => normalizeClarificationQuestion({ ...question, choices: ['Wrong', 'Labels'] })).toThrow();
    expect(() => normalizeClarificationQuestion({ ...question, recommendedChoiceId: 'missing' })).toThrow();
    expect(() => normalizeClarificationQuestion({ choiceDetails: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] })).toThrow();
  });
  it('requires explicit approval decisions without text mappings', () => {
    const approval = { kind: 'approval' as const, approval: { operation: 'Run tool' } };
    expect(normalizeClarificationSubmission(approval, { decision: 'approve' })).toEqual({ answer: 'approve', decision: 'approve' });
    expect(normalizeClarificationSubmission(approval, { decision: 'deny' })).toEqual({ answer: 'deny', decision: 'deny' });
    for (const input of [{ answer: 'Allow once' }, { response: { text: 'approve' } }, {}]) {
      expect(() => normalizeClarificationSubmission(approval, input)).toThrow();
    }
  });
});

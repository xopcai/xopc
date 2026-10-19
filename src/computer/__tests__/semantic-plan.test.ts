import { describe, expect, it } from 'vitest';
import { ComputerButtonPlan, ComputerButtonPlanSchema } from '../semantic-plan.js';

const summary = (label = '0', ref = 'e1', extra: object[] = []) => JSON.stringify({ elements: [
  { role: 'AXWindow' }, { role: 'AXStaticText', label },
  { role: 'AXButton', label: '1', ref, semanticActions: ['activate'] }, ...extra,
] });
const plan = ComputerButtonPlanSchema.parse({ kind: 'button_plan', steps: [
  { label: '1', when: { role: 'AXStaticText', label: '0' } },
  { label: '1', when: { role: 'AXStaticText', label: '1' } },
] });
const input = { goal: 'Enter 11', summary: summary(), stateDigest: 'a', maxPlanActions: 2 };
const history = [{ goal: input.goal, action: 'activate' as const, actionPreview: '{"kind":"activate","ref":"e1"}',
  dispatch: 'completed' as const, outcome: 'unknown' as const, after: '', afterStateDigest: 'b' }];
describe('conditional native button plans', () => {
  it('re-grounds changing refs only after completed input and the exact expected native state', () => {
    const queue = new ComputerButtonPlan(); queue.install(plan, input.goal, 2);
    expect(queue.next(input)).toEqual({ kind: 'activate', ref: 'e1' });
    expect(queue.next({ ...input, summary: summary('1', 'fresh'), stateDigest: 'b', history })).toEqual({ kind: 'activate', ref: 'fresh' });
    expect(queue.next(input)).toBeUndefined();
  });
  it.each([
    { summary: summary('unexpected') },
    { stateDigest: 'a' },
    { history: [{ ...history[0], dispatch: 'unknown' as const }] },
    { history: [{ ...history[0], actionPreview: 'different' }] },
    { stateDigest: 'external' },
    { maxPlanActions: undefined },
    { goal: 'Different goal' },
    { summary: summary('1', 'e2', [{ role: 'AXButton', label: '1', ref: 'duplicate', semanticActions: ['activate'] }]) },
    { summary: summary('1', 'e2', [{ role: 'AXStaticText', label: '1' }]) },
    { summary: JSON.stringify({ ...JSON.parse(summary('1')), truncated: true }) },
    { summary: JSON.stringify({ elements: JSON.parse(summary('1')).elements.map((e: object) => ({ ...e, in_web_content: true })) }) },
  ])('discards the entire remaining plan on changed, ambiguous or unverified state: %j', changed => {
    const queue = new ComputerButtonPlan(); queue.install(plan, input.goal, 2); queue.next(input);
    expect(queue.next({ ...input, summary: summary('1'), stateDigest: 'b', history, ...changed })).toBeUndefined();
    expect(queue.next({ ...input, summary: summary('1'), stateDigest: 'b', history })).toBeUndefined();
  });
  it('matches only full positive native static-text values, including bidi formatting', () => {
    const queue = new ComputerButtonPlan();
    const textPlan = { ...plan, steps: plan.steps.map(s => ({ label: s.label, when: { text: '244' } })) };
    const summaryText = (text: string) => JSON.stringify({ ...JSON.parse(summary()), text, truncated: true });
    queue.install(textPlan, input.goal, 2);
    expect(queue.next({ ...input, summary: summaryText('- AXStaticText = "\u200e244"') })).toEqual({ kind: 'activate', ref: 'e1' });
    for (const text of ['- AXButton "244"', '- AXStaticText = "1244"', '- AXStaticText = "244" extra']) {
      queue.install(textPlan, input.goal, 2);
      expect(queue.next({ ...input, summary: summaryText(text) })).toBeUndefined();
    }
  });
  it('does not install a plan exceeding the remaining action budget', () => {
    expect(() => new ComputerButtonPlan().install(plan, input.goal, 1)).toThrow();
  });
  it('requires an exact expected value for editable-field guards and clears plans on reset', () => {
    expect(ComputerButtonPlanSchema.safeParse({ ...plan, steps: plan.steps.map(step => ({
      ...step, when: { role: 'AXTextField', label: 'Amount' },
    })) }).success).toBe(false);
    const queue = new ComputerButtonPlan(); queue.install(plan, input.goal, 2); queue.reset();
    expect(queue.next(input)).toBeUndefined();
  });
  it('rejects executable text and coordinates in plan steps', () => {
    expect(ComputerButtonPlanSchema.safeParse({ ...plan, steps: [{ ...plan.steps[0], action: { kind: 'pressKeys', keys: ['return'] } }, plan.steps[1]] }).success).toBe(false);
  });
});

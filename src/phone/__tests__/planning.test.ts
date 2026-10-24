import { describe, expect, it } from 'vitest';

import type { PhoneObservation } from '../contracts.js';
import { advancePhonePlan, buildPhonePlan, createPhonePlanState, PhonePlanSchema } from '../planning.js';
import { attachPhonePlan, buildPhoneModelContext, parseAutoGlmResponse, parsePhonePlanningResponse, type PhonePrediction } from '../model-adapter.js';

function screen(overrides: Partial<PhoneObservation> = {}): PhoneObservation {
  return { frameId: 'one', capturedAt: 0, width: 1000, height: 2000, rotation: 0, package: 'com.example.app', frame: Buffer.alloc(0),
    elements: [{ text: 'Search', description: '', resourceId: 'app:id/search', clickable: true, focused: false, editable: true, password: false, bounds: [0, 100, 900, 200] }], ...overrides };
}
function input(): PhonePrediction {
  return { goal: 'Search for coffee', observation: screen(), allowedApps: ['com.example.app'], history: [], enhancements: { hierarchicalPlanning: true, semanticControls: true } };
}
const plan = { steps: [{ goal: 'Open search', appPackage: 'com.example.app', textAll: ['Search'] },
  { goal: 'Enter the query', appPackage: 'com.example.app', field: { resourceId: 'app:id/search', value: 'coffee' } }] };

describe('phone hierarchical native subgoals', () => {
  it('advances sequentially using exact native evidence and never the same frame twice', () => {
    const initial = createPhonePlanState(plan);
    const first = advancePhonePlan(initial, screen());
    expect(first.currentStep).toBe(1);
    expect(initial.currentStep).toBe(0);
    const entered = screen(); entered.elements[0].text = 'coffee';
    expect(advancePhonePlan(first, entered).currentStep).toBe(1);
    entered.frameId = 'two';
    expect(advancePhonePlan(first, entered)).toMatchObject({ currentStep: 2, verifiedSteps: 2 });
  });

  it('does not advance on another app, clipped nodes, password text, or partial text', () => {
    const state = createPhonePlanState(plan);
    expect(advancePhonePlan(state, screen({ package: 'com.other.app' })).currentStep).toBe(0);
    for (const change of [{ bounds: [0, 100, 1001, 200] }, { password: true }, { text: 'Search results' }]) {
      const observation = screen(); Object.assign(observation.elements[0], change);
      expect(advancePhonePlan(state, observation).currentStep).toBe(0);
    }
  });

  it('requires editable exact fields and every conjunctive predicate', () => {
    const state = createPhonePlanState({ steps: [{ goal: 'Verify', appPackage: 'com.example.app', textAll: ['Search'], field: { resourceId: 'app:id/search', value: 'Search' } }] });
    const observation = screen(); observation.elements[0].editable = false;
    expect(advancePhonePlan(state, observation).currentStep).toBe(0);
    observation.elements[0].editable = true;
    expect(advancePhonePlan(state, observation).currentStep).toBe(1);
    observation.elements.push({ ...observation.elements[0], text: 'Another query' });
    expect(advancePhonePlan(state, observation).currentStep).toBe(0);
  });

  it('accepts only bounded observable subgoals, without model completion assertions', () => {
    expect(PhonePlanSchema.safeParse({ steps: [{ goal: 'Done' }] }).success).toBe(false);
    expect(PhonePlanSchema.safeParse({ steps: Array.from({ length: 5 }, () => plan.steps[0]) }).success).toBe(false);
    expect(PhonePlanSchema.safeParse({ ...plan, currentStep: 2 }).success).toBe(false);
  });

  it('extracts an optional plan and preserves the ordinary action parser', () => {
    const result = parsePhonePlanningResponse(`<plan>${JSON.stringify(plan)}</plan>do(action="Back")`, input());
    expect(result.plan).toEqual(plan);
    expect(parseAutoGlmResponse(result.actionText, [])).toEqual({ kind: 'action', action: { type: 'back' } });
    expect(parsePhonePlanningResponse('do(action="Back")', input()).plan).toBeUndefined();
    expect(parsePhonePlanningResponse(`<think>private reasoning</think><answer><plan>${JSON.stringify(plan)}</plan>do(action="Back")</answer>`, input()).plan).toEqual(plan);
  });

  it('preserves the normal action protocol without requiring model-generated plans', () => {
    const action = { kind: 'action' as const, action: { type: 'back' as const } };
    expect(attachPhonePlan(action, undefined, input())).toEqual(action);
    expect(attachPhonePlan(action, plan, input()).plan).toEqual(plan);
    expect(attachPhonePlan(action, undefined, { ...input(), planning: createPhonePlanState(plan) })).toEqual(action);
    expect(attachPhonePlan({ kind: 'needsUser', reason: 'Login' }, undefined, input()).kind).toBe('needsUser');
  });

  it('rejects unapproved apps, malformed plans and replacing an active plan', () => {
    const raw = `<plan>${JSON.stringify(plan)}</plan>do(action="Back")`;
    expect(() => parsePhonePlanningResponse(raw, { ...input(), allowedApps: [] })).toThrow('outside the device allowlist');
    expect(() => parsePhonePlanningResponse(raw, { ...input(), planning: createPhonePlanState(plan) })).toThrow('cannot replace');
    expect(() => parsePhonePlanningResponse('<plan>{}</plan>do(action="Back")', input())).toThrow('predicates');
    expect(() => parsePhonePlanningResponse(`${raw}<plan>{}</plan>`, input())).toThrow('envelope');
  });

  it('adds planning and exact controls only for their own feature flags', () => {
    expect(buildPhoneModelContext({ ...input(), enhancements: undefined })).not.toHaveProperty('planning');
    expect(buildPhoneModelContext({ ...input(), enhancements: { hierarchicalPlanning: true } })).not.toHaveProperty('nativeControls');
    expect(buildPhoneModelContext({ ...input(), enhancements: { semanticControls: true } })).not.toHaveProperty('planning');
    expect(buildPhoneModelContext({ ...input(), planning: createPhonePlanState(plan) })).toMatchObject({ planning: { currentStep: 0, activeSubgoal: plan.steps[0] }, frameId: 'one',
      nativeControls: [{ selector: { resourceId: 'app:id/search', text: 'Search' } }] });
  });

  it('compiles field focus, exact entry and final inspection only from caller conditions', () => {
    const completion = { appPackage: 'com.example.app', textAny: ['Result', 'Results'], textAll: ['coffee'], field: { resourceId: 'app:id/search', value: 'coffee' } };
    const compiled = buildPhonePlan('Search coffee', completion)!;
    expect(compiled.steps).toHaveLength(3);
    expect(compiled.steps[0]).toMatchObject({ appPackage: 'com.example.app', field: { resourceId: 'app:id/search', focused: true } });
    expect(compiled.steps[1].field).toEqual(completion.field);
    expect(compiled.steps[2]).toMatchObject(completion);
    const unfocused = screen();
    const state = createPhonePlanState(compiled);
    expect(advancePhonePlan(state, unfocused).currentStep).toBe(0);
    unfocused.elements[0].focused = true;
    expect(advancePhonePlan(state, unfocused).currentStep).toBe(1);
    expect(buildPhonePlan('An arbitrary task')).toBeUndefined();
  });

  it('compiles navigation anchors and final conjunction without arbitrary task paths', () => {
    const compiled = buildPhonePlan('Inspect', { textAny: ['Heading A', 'Heading B'], textAll: ['Search', 'Value'], requireChange: true })!;
    expect(compiled.steps).toHaveLength(2);
    expect(compiled.steps[0].textAny).toEqual(['Heading A', 'Heading B']);
    expect(compiled.steps[1]).toMatchObject({ textAny: ['Heading A', 'Heading B'], textAll: ['Search', 'Value'] });
    const state = createPhonePlanState(compiled);
    expect(advancePhonePlan(state, screen()).currentStep).toBe(0);
    const observation = screen(); observation.elements[0].text = 'Heading B';
    expect(advancePhonePlan(state, observation).currentStep).toBe(1);
    expect(buildPhonePlan('App only', { appPackage: 'com.example.app' })?.steps).toHaveLength(1);
    expect(buildPhonePlan('Inspect one value', { textAll: ['00h 08m 45s'] })?.steps).toHaveLength(1);
  });

  it('parses semantic targets only when explicitly enabled', () => {
    const raw = 'do(action="TapElement", frameId="one", resourceId="app:id/search", text="Search")';
    expect(() => parseAutoGlmResponse(raw, [])).toThrow('Invalid AutoGLM');
    expect(parseAutoGlmResponse(raw, [], input())).toEqual({ kind: 'action', action: { type: 'tapElement', frameId: 'one', selector: { resourceId: 'app:id/search', text: 'Search' } } });
    expect(() => parseAutoGlmResponse('do(action="TapElement", frameId="one")', [], input())).toThrow('Invalid AutoGLM');
  });
});

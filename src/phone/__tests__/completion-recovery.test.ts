import { expect, it } from 'vitest';

import { phoneCompletionGuidance, phoneCompletionRecoveryHint } from '../completion-recovery.js';
import type { PhoneObservation } from '../contracts.js';

const screen: PhoneObservation = { frameId: 'test', capturedAt: 0, width: 1000, height: 1000, rotation: 0,
  package: 'app.test', frame: Buffer.alloc(0), elements: [] };
it('distinguishes a visible matching file from a missing exact input field', () => {
  const hint = phoneCompletionRecoveryHint({ field: { resourceId: 'app:id/query', value: 'target' } }, screen, false, 1);
  expect(hint).toContain('no unique non-password field (0 matches)');
  expect(hint).toContain('does not prove an exact field condition');
  expect(hint).toContain('authorized by the original goal');
});
it('keeps evidence bounded without truncating the action authorization instructions', () => {
  const hint = phoneCompletionRecoveryHint({ field: { resourceId: 'x'.repeat(300), value: 'y'.repeat(4000) } }, screen, false, 2);
  expect(hint.length).toBeLessThanOrEqual(500);
  expect(hint).toContain('authorized by the original goal'); expect(hint).toMatch(/Do not finish without evidence\.$/);
});
it('does not include password text as observed field evidence', () => {
  const hint = phoneCompletionRecoveryHint({ field: { resourceId: 'query', value: 'target' } }, { ...screen, elements: [{ resourceId: 'query',
    text: 'secret', description: 'secret', editable: true, focused: true, password: true, clickable: true, bounds: [0, 0, 100, 100] }] }, false, 1);
  expect(hint).not.toContain('secret'); expect(hint).toContain('0 matches');
});
it('identifies the actual mismatched native value and missing text without producing actions', () => {
  const node = { resourceId: 'query', text: 'old', description: '', editable: true, focused: true, password: false, clickable: true, bounds: [0, 0, 100, 100] as [number, number, number, number] };
  expect(phoneCompletionRecoveryHint({ field: { resourceId: 'query', value: 'new' } }, { ...screen, elements: [node] }, true, 1)).toContain('observed "old"');
  expect(phoneCompletionRecoveryHint({ textAll: ['Saved'] }, screen, false, 1)).toContain('Required native text missing: "Saved"');
});

const content = { resourceId: 'label', text: 'target.txt', description: '', editable: false, focused: false,
  password: false, clickable: false, bounds: [0, 0, 100, 100] as [number, number, number, number] };
it('warns before a finish claim only for matching content with an absent required input', () => {
  const hint = phoneCompletionGuidance({ field: { resourceId: 'query', value: 'target' } }, { ...screen, elements: [content] }, false)!;
  expect(hint).toContain('Native completion: NOT MET'); expect(hint).not.toContain('rejected');
  expect(hint).toContain('0 matches'); expect(hint).toContain('authorized by the original goal');
  expect(hint).toMatch(/without a screen summary\.$/); expect(hint.length).toBeLessThanOrEqual(500);
});
it('leaves ordinary, already-open, ambiguous, hidden and password input contexts unchanged', () => {
  const criterion = { field: { resourceId: 'query', value: 'target' } };
  for (const elements of [[], [{ ...content, text: 'unrelated' }], [content, { ...content, resourceId: 'query', editable: true }],
    [content, { ...content, resourceId: 'query' }], [{ ...content, editable: true }], [{ ...content, password: true }],
    [{ ...content, bounds: [0, 0, 1100, 100] as [number, number, number, number] }]]) {
    expect(phoneCompletionGuidance(criterion, { ...screen, elements }, false)).toBeUndefined();
  }
  expect(phoneCompletionGuidance({ textAll: ['target'] }, { ...screen, elements: [content] }, false)).toBeUndefined();
  expect(phoneCompletionGuidance({ field: { resourceId: 'query', value: '' } }, { ...screen, elements: [content] }, false)).toBeUndefined();
});

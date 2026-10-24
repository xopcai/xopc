import type { PhoneAction, PhoneCompletion, PhoneElement, PhoneObservation } from './contracts.js';
import type { PhoneTrajectoryEntry } from './model-adapter.js';
import { observationSignature, phoneCompletionSatisfied } from './reliability.js';

function visible(node: PhoneElement, screen: PhoneObservation): boolean {
  return node.bounds.every(Number.isFinite) && node.bounds[0] >= 0 && node.bounds[1] >= 0
    && node.bounds[2] <= screen.width && node.bounds[3] <= screen.height
    && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1];
}

function nativeBackControl(screen: PhoneObservation): boolean {
  return screen.elements.some(node => !node.password && node.clickable && visible(node, screen)
    && node.bounds[1] < screen.height * 0.35 && !node.resourceId.startsWith('com.android.systemui:')
    && [node.description, node.text].some(text => /^(?:navigate up|back|返回|向上导航|返回上一页)$/i.test(text.trim())));
}

export type PhoneBackRecovery = { reason: 'entry_boundary' | 'destination_incomplete'; hint: string };

/** Refuse a risky Back for replanning; this is native navigation evidence, not an OS back-stack proof. */
export function phoneBackRecovery(input: {
  action: PhoneAction; observation: PhoneObservation; entryObservation: PhoneObservation;
  trajectory: PhoneTrajectoryEntry[]; completion?: PhoneCompletion;
}): PhoneBackRecovery | undefined {
  if (input.action.type !== 'back') return undefined;
  const { observation: screen, completion } = input;
  if (screen.elements.some(node => node.focused && node.editable)) return undefined;
  const texts = screen.elements.filter(node => !node.password && visible(node, screen))
    .flatMap(node => [node.text, node.description]).filter(Boolean);
  if (completion?.textAny && (!completion.appPackage || completion.appPackage === screen.package)
    && completion.textAny.some(text => texts.includes(text))
    && !phoneCompletionSatisfied({ ...completion, requireChange: undefined }, screen, true)) {
    return { reason: 'destination_incomplete',
      hint: 'Back was not dispatched: a requested destination anchor is already visible, but required final evidence is missing. Stay on this page and reveal or inspect the remaining evidence; do not leave the destination.' };
  }
  if (screen.package !== input.entryObservation.package || !screen.elements.length || !input.entryObservation.elements.length
    || nativeBackControl(screen)) return undefined;
  const establishedNavigation = input.trajectory.some(entry => entry.actor !== 'human' && entry.dispatch === 'completed'
    && entry.effect === 'changed' && entry.beforeApp === screen.package && entry.afterApp === screen.package
    && ['tap', 'tapElement', 'doubleTap', 'longPress'].includes(entry.action.type));
  if (establishedNavigation) return undefined;
  const sameEntryState = observationSignature(screen) === observationSignature(input.entryObservation);
  const observedScrolling = input.trajectory.length > 0 && input.trajectory.every(entry => entry.actor !== 'human'
    && entry.dispatch === 'completed' && entry.effect !== 'unknown' && entry.beforeApp === screen.package
    && entry.afterApp === screen.package && (entry.action.type === 'swipe' || entry.action.type === 'wait'));
  if (!sameEntryState && !observedScrolling) return undefined;
  return { reason: 'entry_boundary',
    hint: 'Back was not dispatched: this operation has not established a same-app forward navigation or a visible in-app Back control. Scrolling alone does not create a back stack. Inspect the native controls and choose an allowed forward route toward the goal.' };
}

type PhoneTypeAction = Extract<PhoneAction, { type: 'typeText' }>;

/** A missing target needs a new model decision, not a guessed focus or an attempted write. */
export function phoneUnfocusedTypingHint(action: PhoneAction, screen: PhoneObservation, completion?: PhoneCompletion): string | undefined {
  if (action.type !== 'typeText' || screen.elements.some(node => node.focused && node.editable)) return undefined;
  if (completion?.field) {
    return 'No text was sent because the requested editable field is not focused. First navigate to and reveal the exact field identified by completion.field.resourceId, then focus it before typing. Do not repeat Type on the current page while the field is absent.';
  }
  return 'No text was sent because no editable field is focused. Inspect the native UI, navigate to the intended input and focus a visible non-password editable field before typing.';
}

export type PhoneFocusRecovery = {
  focusAction: Extract<PhoneAction, { type: 'tapElement' }>;
  intendedAction: PhoneTypeAction;
  package: string;
  resourceId: string;
  sourceText: string;
  frameId: string;
  width: number;
  height: number;
  rotation: number;
};

/** Focus only an explicitly requested typing target, never synthesize a write from a completion predicate. */
export function preparePhoneFocusRecovery(action: PhoneAction, screen: PhoneObservation, completion?: PhoneCompletion): PhoneFocusRecovery | undefined {
  if (action.type !== 'typeText' || !completion?.field || action.text !== completion.field.value
    || (completion.appPackage && screen.package !== completion.appPackage)
    || screen.elements.some(node => node.focused && node.editable)) return undefined;
  const fields = screen.elements.filter(node => node.editable && node.resourceId === completion.field!.resourceId);
  if (fields.length !== 1) return undefined;
  const field = fields[0];
  if (field.password || !visible(field, screen) || (action.mode !== 'replace' && field.text !== '')) return undefined;
  return {
    focusAction: { type: 'tapElement', frameId: screen.frameId, selector: { resourceId: field.resourceId,
      ...(field.text ? { text: field.text } : {}), ...(field.description ? { description: field.description } : {}) } },
    intendedAction: { ...action }, package: screen.package, resourceId: field.resourceId, sourceText: field.text,
    frameId: screen.frameId, width: screen.width, height: screen.height, rotation: screen.rotation,
  };
}

/** The caller consumes the pending intent once, before dispatch, even if this confirmation rejects it. */
export function confirmPhoneFocusRecovery(recovery: PhoneFocusRecovery, screen: PhoneObservation): PhoneTypeAction | undefined {
  if (screen.frameId === recovery.frameId || screen.package !== recovery.package || screen.width !== recovery.width
    || screen.height !== recovery.height || screen.rotation !== recovery.rotation) return undefined;
  const focused = screen.elements.filter(node => node.editable && node.focused);
  const fields = screen.elements.filter(node => node.editable && node.resourceId === recovery.resourceId);
  if (focused.length !== 1 || fields.length !== 1 || focused[0] !== fields[0]) return undefined;
  const field = fields[0];
  if (field.password || !visible(field, screen) || field.text !== recovery.sourceText) return undefined;
  return { ...recovery.intendedAction };
}

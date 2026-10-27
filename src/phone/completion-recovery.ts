import { phoneCompletionSatisfied } from './reliability.js';
import type { PhoneCompletion, PhoneObservation } from './contracts.js';

export const PHONE_COMPLETION_CORRECTIONS = 2;

function completionHint(completion: PhoneCompletion, screen: PhoneObservation, changed: boolean, prefix: string, concise = false): string {
  let evidence: string;
  const preview = (value: string, limit = 60) => JSON.stringify(value.slice(0, limit));
  if (completion.appPackage && completion.appPackage !== screen.package) {
    evidence = `Required app ${preview(completion.appPackage, 90)}; observed ${preview(screen.package, 90)}.`;
  } else if (completion.field && !phoneCompletionSatisfied({ field: completion.field }, screen, changed)) {
    const fields = screen.elements.filter(node => node.editable && !node.password && node.resourceId === completion.field!.resourceId);
    evidence = `Editable field ${preview(completion.field.resourceId, 100)} must equal ${preview(completion.field.value)}; `
      + (fields.length === 1 ? `observed ${preview(fields[0].text)}.` : `no unique non-password field (${fields.length} matches).`);
  } else {
    const texts = screen.elements.filter(node => !node.password).flatMap(node => [node.text, node.description]);
    const missing = completion.textAll?.find(value => !texts.some(text => text.includes(value)));
    evidence = missing ? `Required native text missing: ${preview(missing, 100)}.`
      : completion.textAny && !completion.textAny.some(value => texts.some(text => text.includes(value)))
        ? `No required native text alternative is visible: ${preview(completion.textAny[0], 100)}.`
        : 'The required UI change has not been observed.';
  }
  const instruction = (completion.field ? 'Matching visible content does not prove an exact field condition. ' : '')
    + 'Return one safe action authorized by the original goal, or request takeover if blocked. Do not finish without evidence.'
    + (concise ? ' Return only the action, without a screen summary.' : '');
  return `${prefix}${evidence.slice(0, 500 - prefix.length - instruction.length - 1)} ${instruction}`;
}

/** Warn only when visible matching content could be mistaken for an absent exact input field. */
export function phoneCompletionGuidance(completion: PhoneCompletion, screen: PhoneObservation, changed: boolean): string | undefined {
  const field = completion.field;
  if (!field?.value.trim() || screen.elements.some(node => node.resourceId === field.resourceId)) return undefined;
  const matchingContent = screen.elements.some(node => !node.password && !node.editable
    && node.bounds[0] >= 0 && node.bounds[1] >= 0 && node.bounds[2] <= screen.width && node.bounds[3] <= screen.height
    && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1]
    && [node.text, node.description].some(text => text.includes(field.value)));
  return matchingContent ? completionHint(completion, screen, changed, 'Native completion: NOT MET. ', true) : undefined;
}

/** Diagnostic feedback only; completion conditions never authorize generated device actions. */
export function phoneCompletionRecoveryHint(completion: PhoneCompletion, screen: PhoneObservation, changed: boolean, attempt: number): string {
  return completionHint(completion, screen, changed, `Completion rejected (${attempt}/${PHONE_COMPLETION_CORRECTIONS}). `);
}

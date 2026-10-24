import { createHash } from 'node:crypto';

import type { PhoneAction, PhoneCompletion, PhoneElement, PhoneObservation } from './contracts.js';

function geometryMatches(before: PhoneObservation, after: PhoneObservation): boolean {
  return before.package === after.package && before.width === after.width && before.height === after.height && before.rotation === after.rotation;
}

function ambientClock(node: PhoneElement): boolean {
  const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s?[AP]M)?$/i;
  return node.resourceId === 'com.android.systemui:id/clock' && !node.clickable && !node.editable && !node.focused && !node.password
    && clock.test(node.text) && (!node.description || clock.test(node.description));
}

function semanticElements(observation: PhoneObservation): PhoneElement[] {
  return observation.elements.map(node => ambientClock(node) ? { ...node, text: '', description: '' } : node);
}

/** Ignore only recognized inert system-clock text, never arbitrary application content. */
export function observationSignature(observation: PhoneObservation): string {
  return createHash('sha256').update(JSON.stringify([observation.package, observation.width, observation.height, observation.rotation,
    observation.elements.length ? semanticElements(observation)
      : createHash('sha256').update(observation.frame).digest('hex')])).digest('hex');
}

function atPoint(elements: PhoneElement[], x: number, y: number): PhoneElement[] {
  return elements.filter(node => node.bounds[0] <= x && x < node.bounds[2] && node.bounds[1] <= y && y < node.bounds[3]);
}

/** Preserve full page semantics; only inert system-clock updates may be ignored. */
export function canDispatchPhoneAction(action: PhoneAction, before: PhoneObservation, fresh: PhoneObservation): boolean {
  if (!geometryMatches(before, fresh)) return false;
  if (JSON.stringify(before.elements) === JSON.stringify(fresh.elements)) {
    return before.elements.length > 0 || fresh.frame.equals(before.frame);
  }
  if (JSON.stringify(semanticElements(before)) !== JSON.stringify(semanticElements(fresh))) return false;
  if (action.type === 'tap' || action.type === 'doubleTap' || action.type === 'longPress') {
    const [x, y] = [action.point[0] * before.width / 1000, action.point[1] * before.height / 1000];
    const targets = atPoint(before.elements, x, y);
    // No accessibility target, ambiguous duplicate IDs, or a new overlay keeps the conservative guard.
    const identified = targets.filter(node => node.resourceId && node.clickable && !node.password);
    if (identified.length !== 1) return false;
    const target = identified[0];
    if (before.elements.filter(node => node.resourceId === target.resourceId).length !== 1
      || fresh.elements.filter(node => node.resourceId === target.resourceId).length !== 1) return false;
    return JSON.stringify(targets) === JSON.stringify(atPoint(fresh.elements, x, y));
  }
  if (action.type === 'typeText') {
    const focused = (screen: PhoneObservation) => screen.elements.filter(node => node.focused && node.editable && !node.password);
    const previous = focused(before); const current = focused(fresh);
    return previous.length === 1 && current.length === 1 && Boolean(previous[0].resourceId)
      && JSON.stringify(previous) === JSON.stringify(current);
  }
  return false;
}

/** Evaluate all native nodes, separately from the truncated display facts. */
export function phoneCompletionSatisfied(condition: PhoneCompletion, observation: PhoneObservation, changed: boolean): boolean {
  if (condition.requireChange && !changed) return false;
  if (condition.appPackage && condition.appPackage !== observation.package) return false;
  const texts = observation.elements.filter(node => !node.password).flatMap(node => [node.text, node.description]).filter(Boolean);
  if (condition.textAny && !condition.textAny.some(value => texts.some(text => text.includes(value)))) return false;
  if (condition.textAll && !condition.textAll.every(value => texts.some(text => text.includes(value)))) return false;
  if (condition.field) {
    const fields = observation.elements.filter(node => !node.password && node.editable && node.resourceId === condition.field!.resourceId);
    if (fields.length !== 1 || fields[0].text !== condition.field.value) return false;
  }
  return true;
}

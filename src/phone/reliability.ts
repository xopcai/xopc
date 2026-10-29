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

function inert(node: PhoneElement): boolean {
  return !node.clickable && !node.editable && !node.focused && !node.password;
}

function settingsUptime(observation: PhoneObservation): PhoneElement | undefined {
  if (observation.package !== 'com.android.settings'
    || !observation.elements.some(node => inert(node) && [node.text, node.description].some(text => /^(?:关于手机|关于设备|About phone|About device)$/i.test(text)))) return;
  const labels = observation.elements.filter(node => inert(node) && node.resourceId === 'android:id/title'
    && /^(?:开机累计时长|已开机时间|正常运行时间|Up time|Uptime)$/i.test(node.text));
  if (labels.length !== 1) return;
  const label = labels[0];
  const values = observation.elements.filter(node => inert(node) && node.resourceId === 'android:id/summary'
    && /^\d{1,6}:[0-5]\d:[0-5]\d$/.test(node.text) && (!node.description || node.description === node.text)
    && node.bounds[0] === label.bounds[0] && node.bounds[1] >= label.bounds[3]
    && node.bounds[1] - label.bounds[3] <= Math.max(16, node.bounds[3] - node.bounds[1]));
  return values.length === 1 ? values[0] : undefined;
}

function semanticElements(observation: PhoneObservation): PhoneElement[] {
  const uptime = settingsUptime(observation);
  return observation.elements.map(node => ambientClock(node) || node === uptime ? { ...node, text: '', description: '' } : node);
}

/** Ignore recognized inert system clocks and the labeled Settings uptime value. */
export function observationSignature(observation: PhoneObservation): string {
  return createHash('sha256').update(JSON.stringify([observation.package, observation.width, observation.height, observation.rotation,
    observation.elements.length ? semanticElements(observation)
      : createHash('sha256').update(observation.frame).digest('hex')])).digest('hex');
}

function atPoint(elements: PhoneElement[], x: number, y: number): PhoneElement[] {
  return elements.filter(node => node.bounds[0] <= x && x < node.bounds[2] && node.bounds[1] <= y && y < node.bounds[3]);
}

/** Search-entry navigation can survive unrelated carousels; its hit stack stays identical except for the rotating placeholder. */
function stableSearchEntry(action: PhoneAction, before: PhoneObservation, fresh: PhoneObservation): boolean {
  if (action.type !== 'tap') return false;
  const x = action.point[0] * before.width / 1000;
  const y = action.point[1] * before.height / 1000;
  const isSearchEntry = (node: PhoneElement) => !node.password && !node.editable
    && /^(?:搜索栏|搜索框|search bar|search box)$/i.test(node.description || node.text)
    && node.bounds[0] >= 0 && node.bounds[1] >= 0 && node.bounds[2] <= before.width && node.bounds[3] <= before.height
    && (node.bounds[2] - node.bounds[0]) * (node.bounds[3] - node.bounds[1]) < before.width * before.height / 5;
  const entries = before.elements.filter(isSearchEntry);
  if (entries.length !== 1 || fresh.elements.filter(isSearchEntry).length !== 1) return false;
  const entry = entries[0];
  const hits = atPoint(before.elements, x, y);
  const insideEntry = (node: PhoneElement) => node.bounds[0] >= entry.bounds[0] && node.bounds[1] >= entry.bounds[1]
    && node.bounds[2] <= entry.bounds[2] && node.bounds[3] <= entry.bounds[3];
  const placeholderWrappers = (screen: PhoneObservation) => screen.elements.filter(node => insideEntry(node)
    && node.clickable && !node.editable && !node.password && !node.resourceId && !node.text && !node.description
    && node.bounds[2] - node.bounds[0] < (entry.bounds[2] - entry.bounds[0]) * 0.7
    && screen.elements.some(child => inert(child) && !child.resourceId && Boolean(child.text)
      && child.bounds[0] >= node.bounds[0] && child.bounds[1] >= node.bounds[1]
      && child.bounds[2] <= node.bounds[2] && child.bounds[3] <= node.bounds[3]));
  const oldWrappers = placeholderWrappers(before); const newWrappers = placeholderWrappers(fresh);
  if (oldWrappers.length !== newWrappers.length || oldWrappers.length > 1) return false;
  const hitStack = (screen: PhoneObservation) => atPoint(screen.elements, x, y).filter(node => {
    if ((screen === before ? oldWrappers : newWrappers).includes(node)) return false;
    // A rotating placeholder is decoration inside the search entry, not its identity.
    const placeholder = inert(node) && !node.resourceId && node !== entry
      && node.bounds[0] >= entry.bounds[0] && node.bounds[1] >= entry.bounds[1]
      && node.bounds[2] <= entry.bounds[2] && node.bounds[3] <= entry.bounds[3]
      && !isSearchEntry(node);
    return !placeholder;
  });
  return hits.includes(entry) && !hits.some(node => node.password || node.editable)
    && hits.some(node => node.clickable)
    && JSON.stringify(hitStack(before)) === JSON.stringify(hitStack(fresh));
}

/** Preserve page semantics and geometry while ignoring recognized ambient counters. */
export function canDispatchPhoneAction(action: PhoneAction, before: PhoneObservation, fresh: PhoneObservation): boolean {
  if (!geometryMatches(before, fresh)) return false;
  if (action.type === 'wait') return true;
  if (JSON.stringify(before.elements) === JSON.stringify(fresh.elements)) {
    return before.elements.length > 0 || fresh.frame.equals(before.frame);
  }
  if (JSON.stringify(semanticElements(before)) !== JSON.stringify(semanticElements(fresh)))
    return stableSearchEntry(action, before, fresh);
  if (action.type === 'tap' || action.type === 'doubleTap' || action.type === 'longPress') {
    const [x, y] = [action.point[0] * before.width / 1000, action.point[1] * before.height / 1000];
    const targets = atPoint(before.elements, x, y);
    // No accessibility target, ambiguous duplicate IDs, or a new overlay keeps the conservative guard.
    const identified = targets.filter(node => (node.resourceId || node.description || node.text) && node.clickable && !node.password);
    if (identified.length !== 1) return false;
    const target = identified[0];
    const sameIdentity = (node: PhoneElement) => target.resourceId ? node.resourceId === target.resourceId
      : node.clickable && node.text === target.text && node.description === target.description;
    if (before.elements.filter(sameIdentity).length !== 1 || fresh.elements.filter(sameIdentity).length !== 1) return false;
    return JSON.stringify(targets) === JSON.stringify(atPoint(fresh.elements, x, y));
  }
  if (action.type === 'typeText') {
    const focused = (screen: PhoneObservation) => screen.elements.filter(node => node.focused && node.editable && !node.password);
    const previous = focused(before); const current = focused(fresh);
    return previous.length === 1 && current.length === 1 && Boolean(previous[0].resourceId)
      && JSON.stringify(previous) === JSON.stringify(current);
  }
  return action.type === 'back' || action.type === 'swipe';
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

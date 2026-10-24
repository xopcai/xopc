import { PhoneActionSchema, PhoneError, type PhoneAction, type PhoneElement, type PhoneElementSelector, type PhoneObservation } from './contracts.js';
import { canDispatchPhoneAction } from './reliability.js';

export type PhonePrimitiveAction = Exclude<PhoneAction, { type: 'tapElement' }>;

function visible(node: PhoneElement, screen: PhoneObservation): boolean {
  const [left, top, right, bottom] = node.bounds;
  return !node.password && node.bounds.every(Number.isFinite) && left >= 0 && top >= 0
    && right <= screen.width && bottom <= screen.height && right > left && bottom > top;
}

function matches(node: PhoneElement, selector: PhoneElementSelector): boolean {
  return (selector.resourceId === undefined || node.resourceId === selector.resourceId)
    && (selector.text === undefined || node.text === selector.text)
    && (selector.description === undefined || node.description === selector.description);
}

function candidates(screen: PhoneObservation, selector: PhoneElementSelector): PhoneElement[] {
  return screen.elements.filter(node => visible(node, screen) && matches(node, selector));
}

function exactSelector(node: PhoneElement): PhoneElementSelector {
  const selector: PhoneElementSelector = {};
  if (node.resourceId && node.resourceId.length <= 300) selector.resourceId = node.resourceId;
  if (node.text && node.text.length <= 4000) selector.text = node.text;
  if (node.description && node.description.length <= 1000) selector.description = node.description;
  return selector;
}

/** Offer exact identities only when one fully visible native node matches. */
export function phoneSemanticControls(screen: PhoneObservation): Array<{ frameId: string; selector: PhoneElementSelector }> {
  return screen.elements.filter(node => visible(node, screen)).flatMap(node => {
    const selector = exactSelector(node);
    return Object.keys(selector).length && candidates(screen, selector).length === 1 ? [{ frameId: screen.frameId, selector }] : [];
  }).slice(0, 40);
}

function containsPoint(node: PhoneElement, x: number, y: number): boolean {
  return x >= node.bounds[0] && y >= node.bounds[1] && x < node.bounds[2] && y < node.bounds[3];
}

function containsNode(outer: PhoneElement, inner: PhoneElement): boolean {
  return outer.bounds[0] <= inner.bounds[0] && outer.bounds[1] <= inner.bounds[1]
    && outer.bounds[2] >= inner.bounds[2] && outer.bounds[3] >= inner.bounds[3];
}

/** Ground ordinary model taps only when native hit-testing identifies one bounded control. */
export function groundPhoneCoordinateAction(action: PhoneAction, screen: PhoneObservation): PhoneAction {
  if (action.type !== 'tap') return action;
  const [x, y] = [action.point[0] * screen.width / 1000, action.point[1] * screen.height / 1000];
  if (screen.elements.some(node => node.password && containsPoint(node, x, y))) return action;
  const actionable = screen.elements.filter(node => visible(node, screen) && (node.clickable || node.editable));
  const hits = actionable.filter(node => containsPoint(node, x, y));
  const smallest = hits.filter(node => hits.every(other => other === node || containsNode(other, node)));
  if (smallest.length !== 1) return action;
  const target = smallest[0];
  if ((target.bounds[2] - target.bounds[0]) * (target.bounds[3] - target.bounds[1]) > screen.width * screen.height / 4) return action;
  const selector = exactSelector(target);
  if (!Object.keys(selector).length || candidates(screen, selector).length !== 1) return action;
  const [centerX, centerY] = [(target.bounds[0] + target.bounds[2]) / 2, (target.bounds[1] + target.bounds[3]) / 2];
  if (screen.elements.some(node => node.password && containsPoint(node, centerX, centerY))
    || actionable.some(node => node !== target && containsPoint(node, centerX, centerY) && !containsNode(node, target))) return action;
  return { type: 'tapElement', frameId: screen.frameId, selector };
}

/** Resolve against the prediction snapshot and a fresh snapshot before any dispatch. */
export function resolvePhoneSemanticAction(action: PhoneAction, predicted: PhoneObservation, fresh: PhoneObservation = predicted): PhonePrimitiveAction {
  if (action.type !== 'tapElement') return action;
  const parsed = PhoneActionSchema.safeParse(action);
  if (!parsed.success) throw new PhoneError('PHONE_SEMANTIC_INVALID', 'Invalid exact native element selector', 409);
  if (action.frameId !== predicted.frameId) throw new PhoneError('PHONE_SEMANTIC_STALE', 'Native element belongs to a different observation', 409);
  const before = candidates(predicted, action.selector);
  const after = candidates(fresh, action.selector);
  if (before.length !== 1 || after.length !== 1)
    throw new PhoneError('PHONE_SEMANTIC_TARGET', 'Native element selector must match exactly one fully visible non-password node', 409);
  const target = after[0];
  const resolved: PhonePrimitiveAction = { type: 'tap', point: [
    500 * (target.bounds[0] + target.bounds[2]) / fresh.width,
    500 * (target.bounds[1] + target.bounds[3]) / fresh.height,
  ] };
  if (JSON.stringify(before[0]) !== JSON.stringify(target) || !canDispatchPhoneAction(resolved, predicted, fresh))
    throw new PhoneError('PHONE_SEMANTIC_STALE', 'Native element or page changed before dispatch', 409);
  return resolved;
}

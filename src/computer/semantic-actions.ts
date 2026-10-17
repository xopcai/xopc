import type { ComputerAction, ComputerObservation } from '@xopcai/computer-control-contract';

/** Ground only an unambiguous single click; never reinterpret double clicks or text entry. */
export function groundComputerAction(action: ComputerAction, observation: ComputerObservation): ComputerAction {
  if (action.kind !== 'click' || action.count !== 1 || action.point.x < 0 || action.point.y < 0
    || action.point.x >= observation.imageWidth || action.point.y >= observation.imageHeight) return action;
  const kind = action.button === 'left' ? 'activate' : 'showMenu';
  try {
    const { elements, truncated } = JSON.parse(observation.summary);
    if (!Array.isArray(elements) || truncated === true) return action;
    const candidates = elements.filter(element => {
      if (!element || typeof element !== 'object') return false;
      const b = element.bounds;
      // Disabled/unsupported overlapping controls still make the hit ambiguous.
      const interactive = (Array.isArray(element.actions) && element.actions.some(name => name === 'AXPress' || name === 'AXShowMenu'))
        || element.semanticActions?.length
        || /^AX(Button|CheckBox|RadioButton|DisclosureTriangle|PopUpButton|ComboBox|TextField|TextArea|SecureTextField|Link|Row|Cell|Slider)$/.test(element.role);
      return interactive
        && b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0
        && action.point.x >= b.x && action.point.y >= b.y
        && action.point.x < b.x + b.width && action.point.y < b.y + b.height;
    });
    const element = candidates.length === 1 ? candidates[0] : undefined;
    return element && typeof element.ref === 'string' && element.enabled !== false && element.in_web_content !== true
      && Array.isArray(element.semanticActions) && element.semanticActions.includes(kind) ? { kind, ref: element.ref } : action;
  } catch { return action; }
}

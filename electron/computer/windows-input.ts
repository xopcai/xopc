import type { WindowsInputField, WindowsInputState } from './windows-native.js';

/** Bind native safety metadata to one current Cua row, never just its label. */
export function matchWindowsInput(row: Record<string, unknown>, fields: WindowsInputField[],
  rows: Array<Record<string, unknown>> = []): WindowsInputField | undefined {
  const frame = row.frame as { x: number; y: number; w: number; h: number } | undefined;
  const roles: Record<string, string> = { Edit: 'ControlType.Edit', Document: 'ControlType.Document', Button: 'ControlType.Button' };
  if (!frame || !roles[String(row.role)] || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) return;
  const found = fields.filter(field => (field.role === roles[String(row.role)]
    || ['Edit', 'Document'].includes(String(row.role)) && ['ControlType.Edit', 'ControlType.Document'].includes(field.role)) && field.w > 0 && field.h > 0
    && Math.abs(field.x - frame.x) < 0.5 && Math.abs(field.y - frame.y) < 0.5
    && Math.abs(field.w - frame.w) < 0.5 && Math.abs(field.h - frame.h) < 0.5);
  if (found.length === 1) return found[0];
  // Qt exposes an outer Edit and its inner editor at identical bounds. Bind only
  // the child when both independent trees prove the same safe parent/child pair.
  if (found.length !== 2 || !found.every(windowsInputAllowed)) return;
  const child = found.find(field => found.some(parent => field.parentRuntimeId === parent.runtimeId));
  if (!child) return;
  const peers = rows.filter(candidate => {
    const b = candidate.frame as typeof frame;
    return candidate.role === row.role && b && b.x === frame.x && b.y === frame.y && b.w === frame.w && b.h === frame.h;
  });
  if (peers.length !== 2 || !peers.includes(row)) return;
  const parent = peers.find(candidate => String(candidate.element_index) === String(row.parent_index));
  return parent && parent !== row && parent.enabled !== false && parent.in_web_content !== true ? child : undefined;
}

export function windowsInputAllowed(field?: WindowsInputField): boolean {
  return !!field && field.password === false && field.enabled && !field.offscreen && field.writable;
}

export function enrichWindowsInput(rows: Array<Record<string, unknown>>, state?: WindowsInputState) {
  return rows.map(row => {
    const isField = row.role === 'Edit' || row.role === 'Document';
    const metadata = matchWindowsInput(row, state?.fields ?? [], rows);
    const focused = state?.focused && matchWindowsInput(row, [state.focused]);
    const allowed = isField && windowsInputAllowed(metadata) && row.enabled !== false && row.in_web_content !== true;
    const verifiedFocus = focused?.password === false && focused.enabled && !focused.offscreen
      && (!isField || metadata?.runtimeId === focused.runtimeId);
    const sameLabel = state?.fields.filter(field => field.label === row.label) ?? [];
    const uniqueLabel = allowed && state?.fields.every(field => typeof field.label === 'string')
      && typeof row.label === 'string' && row.label.length > 0
      && (sameLabel.length === 1 && sameLabel[0].runtimeId === metadata?.runtimeId
        || sameLabel.length === 2 && sameLabel.every(windowsInputAllowed)
          && sameLabel.some(parent => parent.runtimeId === metadata?.parentRuntimeId
            && parent.x === metadata.x && parent.y === metadata.y && parent.w === metadata.w && parent.h === metadata.h)
          && rows.some(parent => parent !== row && String(parent.element_index) === String(row.parent_index)
            && JSON.stringify(parent.frame) === JSON.stringify(row.frame)));
    const { value: _value, value_description: _description, label: _label, ...rest } = row;
    return {
      ...(isField && !allowed ? { ...rest, label: metadata?.password === true ? 'Protected input' : 'Unverified input',
        role: metadata?.password === true ? 'SecureEdit' : 'UnverifiedEdit' } : row),
      ...(isField ? { inputAllowed: allowed } : {}),
      ...(uniqueLabel ? { fieldLabelUnique: true } : {}),
      ...(metadata ? { windows_runtime_id: metadata.runtimeId } : {}),
      ...(verifiedFocus ? { windows_focus_id: focused.runtimeId, keyboardFocused: true } : {}),
    };
  });
}

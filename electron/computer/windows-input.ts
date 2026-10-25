import type { WindowsInputField, WindowsInputState } from './windows-native.js';

/** Bind native safety metadata to one current Cua row, never just its label. */
export function matchWindowsInput(row: Record<string, unknown>, fields: WindowsInputField[]): WindowsInputField | undefined {
  const frame = row.frame as { x: number; y: number; w: number; h: number } | undefined;
  const roles: Record<string, string> = { Edit: 'ControlType.Edit', Document: 'ControlType.Document', Button: 'ControlType.Button' };
  if (!frame || !roles[String(row.role)] || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) return;
  const found = fields.filter(field => (field.role === roles[String(row.role)]
    || ['Edit', 'Document'].includes(String(row.role)) && ['ControlType.Edit', 'ControlType.Document'].includes(field.role)) && field.w > 0 && field.h > 0
    && Math.abs(field.x - frame.x) < 0.5 && Math.abs(field.y - frame.y) < 0.5
    && Math.abs(field.w - frame.w) < 0.5 && Math.abs(field.h - frame.h) < 0.5);
  return found.length === 1 ? found[0] : undefined;
}

export function windowsInputAllowed(field?: WindowsInputField): boolean {
  return !!field && field.password === false && field.enabled && !field.offscreen && field.writable;
}

export function enrichWindowsInput(rows: Array<Record<string, unknown>>, state?: WindowsInputState) {
  return rows.map(row => {
    const isField = row.role === 'Edit' || row.role === 'Document';
    const metadata = matchWindowsInput(row, state?.fields ?? []);
    const focused = state?.focused && matchWindowsInput(row, [state.focused]);
    const allowed = isField && windowsInputAllowed(metadata) && row.enabled !== false && row.in_web_content !== true;
    const verifiedFocus = focused?.password === false && focused.enabled && !focused.offscreen;
    const { value: _value, value_description: _description, label: _label, ...rest } = row;
    return {
      ...(isField && !allowed ? { ...rest, label: metadata?.password === true ? 'Protected input' : 'Unverified input',
        role: metadata?.password === true ? 'SecureEdit' : 'UnverifiedEdit' } : row),
      ...(isField ? { inputAllowed: allowed } : {}),
      ...(metadata ? { windows_runtime_id: metadata.runtimeId } : {}),
      ...(verifiedFocus ? { windows_focus_id: focused.runtimeId, keyboardFocused: true } : {}),
    };
  });
}

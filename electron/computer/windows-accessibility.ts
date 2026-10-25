/** Normalize the pinned UIA observation without claiming complete tree coverage. */
export function normalizeWindowsAccessibility(rows: Array<Record<string, unknown>>, nativeText = '') {
  const roles: Record<string, string> = { Window: 'AXWindow', Button: 'AXButton', Text: 'AXStaticText', Edit: 'AXTextField', Document: 'AXTextArea', SecureEdit: 'AXSecureTextField',
    CheckBox: 'AXCheckBox', RadioButton: 'AXRadioButton', ComboBox: 'AXComboBox', TabItem: 'AXRadioButton',
    Hyperlink: 'AXLink', Slider: 'AXSlider', Menu: 'AXMenu', MenuItem: 'AXMenuItem', MenuBar: 'AXMenuBar' };
  const ids = new Set(rows.map(row => String(row.element_index)));
  let root = 0n;
  while (ids.has(root.toString())) root++;
  const rootId = root.toString();
  const elements: Array<Record<string, unknown>> = [{ element_index: rootId, role: 'AXWindow', depth: 0 }, ...rows.map(row => ({
    ...row, native_role: row.role, role: roles[String(row.role)] ?? `UIA${String(row.role)}`,
    depth: Number(row.depth) + 1,
    parent_index: row.parent_index != null && ids.has(String(row.parent_index)) ? row.parent_index : rootId,
    // Only Invoke is certified here. Toggle/selection/context-menu semantics need separate acceptance.
    actions: Array.isArray(row.actions) && row.actions.includes('invoke') && row.role === 'Button' ? ['AXPress'] : [],
  }))];
  const text = elements.map(row => `${'  '.repeat(Math.min(30, Number(row.depth)))}- [${row.element_index}] ${row.role}${
    typeof row.label === 'string' ? ` ${JSON.stringify(row.label)}` : ''}${typeof row.value === 'string' ? ` = ${JSON.stringify(row.value)}` : ''}`).join('\n');
  // The pinned driver omits non-actionable UIA Text rows from `elements`.
  // Retain only their exact-window text; never reintroduce raw Edit values.
  let editDepth: number | undefined;
  const staticLines: string[] = [];
  for (const line of nativeText.split('\n')) {
    const item = line.match(/^(\s*)- (?:\[\d+\] )?(\w+)(?:\s|$)/);
    if (!item) continue;
    const depth = item[1].length;
    if (editDepth !== undefined && depth > editDepth) continue;
    editDepth = undefined;
    if (['Edit', 'Document', 'SecureEdit'].includes(item[2])) { editDepth = depth; continue; }
    if (item[2] === 'Text') staticLines.push(line.replace(/^(\s*- (?:\[\d+\] )?)Text/, '$1AXStaticText'));
  }
  const staticText = staticLines.join('\n');
  return { elements, text: staticText ? `${text}\n${staticText}` : text, truncated: true };
}

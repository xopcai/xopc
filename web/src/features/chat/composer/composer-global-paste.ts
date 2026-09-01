const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('textarea, select, [role="textbox"]')) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;

  const input = target.closest('input');
  return input instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(input.type);
}

function hasOpenModal(): boolean {
  return Boolean(
    document.querySelector(
      'dialog[open], [aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ),
  );
}

export function shouldRouteGlobalComposerPaste(
  event: ClipboardEvent,
  options: { disabled: boolean; editorHidden: boolean },
): boolean {
  if (options.disabled || options.editorHidden || event.defaultPrevented) return false;
  if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return false;
  return !hasOpenModal();
}

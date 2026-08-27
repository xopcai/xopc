export function terminalShortcutLabel(platform: string | undefined): string {
  return platform === 'darwin' ? '⌘J' : 'Ctrl+J';
}

export function matchesTerminalShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'>,
  platform: string | undefined,
): boolean {
  if (event.repeat || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return false;
  return platform === 'darwin'
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function isMacPlatform(platform: string | undefined): boolean {
  if (platform) return platform === 'darwin';
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.includes('Mac') ?? navigator.userAgent.includes('Mac');
}

export function sideChatShortcutLabel(platform: string | undefined): string {
  return isMacPlatform(platform) ? '⌘⇧B' : 'Ctrl+Shift+B';
}

export function sideChatShortcutKeys(platform: string | undefined): string[] {
  return isMacPlatform(platform) ? ['⌘', 'Shift', 'B'] : ['Ctrl', 'Shift', 'B'];
}

export function sideChatAriaKeyShortcut(platform: string | undefined): string {
  return isMacPlatform(platform) ? 'Meta+Shift+B' : 'Control+Shift+B';
}

export function matchesSideChatShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'>,
  platform: string | undefined,
): boolean {
  if (event.repeat || event.altKey || !event.shiftKey || event.key.toLowerCase() !== 'b') return false;
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

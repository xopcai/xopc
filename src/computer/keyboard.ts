/** Normalize individual key names; combined chord strings are deliberately rejected. */
export function normalizeComputerKeys(input: string[], platform: NodeJS.Platform = 'darwin'): string[] {
  const aliases: Record<string, string> = { enter: 'return', esc: 'escape', backspace: 'delete', arrowup: 'up', arrowdown: 'down',
    arrowleft: 'left', arrowright: 'right', command: 'cmd', meta: 'cmd', super: 'cmd', '⌘': 'cmd', control: 'ctrl', option: 'alt', '⌥': 'alt' };
  const keys = input.map(key => aliases[key.toLowerCase()] ?? key.toLowerCase());
  if (platform === 'win32') {
    if (keys.includes('cmd') || keys.some(key => ['win', 'windows', 'fn'].includes(key))) throw new Error('COMPUTER_KEY_NOT_SUPPORTED');
    // Cua's Windows key vocabulary distinguishes forward delete from backspace.
    const main = input.at(-1)?.toLowerCase();
    if (main === 'backspace') keys[keys.length - 1] = 'backspace';
  }
  if (!keys.length || keys.length > 4 || !keys.slice(0, -1).every(key => ['cmd', 'ctrl', 'alt', 'shift', 'fn'].includes(key))
    || !/^(return|tab|escape|up|down|left|right|space|delete|backspace|home|end|pageup|pagedown|f[1-9]|f1[0-2]|[a-z0-9])$/.test(keys.at(-1)!)) {
    throw new Error('COMPUTER_KEY_NOT_SUPPORTED');
  }
  return keys;
}

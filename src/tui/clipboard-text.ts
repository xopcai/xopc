import { spawnSync } from 'node:child_process';

export class ClipboardTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipboardTextError';
  }
}

function tryWrite(command: string, args: string[], text: string): boolean {
  const result = spawnSync(command, args, {
    input: text,
    timeout: 3000,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  return !result.error && result.status === 0;
}

/** Copy text to the system clipboard using common platform tools. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (process.platform === 'darwin') {
    if (tryWrite('pbcopy', [], text)) return;
    throw new ClipboardTextError('pbcopy failed');
  }

  if (process.platform === 'win32') {
    if (tryWrite('clip.exe', [], text)) return;
    throw new ClipboardTextError('clip.exe failed');
  }

  const candidates: Array<[string, string[]]> = process.env.WAYLAND_DISPLAY
    ? [
        ['wl-copy', []],
        ['xclip', ['-selection', 'clipboard']],
        ['xsel', ['--clipboard', '--input']],
      ]
    : [
        ['xclip', ['-selection', 'clipboard']],
        ['xsel', ['--clipboard', '--input']],
        ['wl-copy', []],
      ];

  for (const [command, args] of candidates) {
    if (tryWrite(command, args, text)) return;
  }

  throw new ClipboardTextError('No supported clipboard command found');
}

import { password } from '@inquirer/prompts';

/**
 * Prompt for a secret value (API key, token, etc.) without echoing it to the
 * terminal. Returns the trimmed string, or throws `ExitPromptError` if the
 * user cancels with Ctrl+C — callers should let it propagate and exit
 * with `SETUP_EXIT.CANCELLED`.
 */
export async function promptSecret(message: string): Promise<string> {
  const value = await password({
    message,
    mask: '*',
    validate: (input) => (input.trim().length > 0 ? true : 'Value cannot be empty'),
  });
  return value.trim();
}

/**
 * True if running in a non-interactive context (no TTY, CI, etc.). Used to
 * skip interactive prompts and require flags instead.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Detect `@inquirer/prompts` Ctrl+C cancellation. Matches both the modern
 * `ExitPromptError` name and the legacy `prompt was cancelled` message.
 */
export function isPromptCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return err.name === 'ExitPromptError' || /cancel/i.test(err.message ?? '');
}

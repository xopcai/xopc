/**
 * Telegram sends `/cmd@BotUsername` in groups and from the command menu; registries
 * store commands as `cmd` only, so strip the @bot suffix before lookup.
 */
export function normalizeTelegramCommandName(command: string): string {
  const at = command.indexOf('@');
  return (at === -1 ? command : command.slice(0, at)).toLowerCase();
}

/**
 * Parse a `/command` from message text. Handles:
 * - `/cmd@BotName` and arguments
 * - Multiline: voice STT text before a line that starts with `/` (Telegram caption after transcript)
 */
export function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const part of trimmed.split(/\r?\n/)) {
    const line = part.trim();
    if (!line.startsWith('/')) continue;

    const withoutPrefix = line.slice(1);
    const whitespaceIndex = withoutPrefix.search(/\s/);
    if (whitespaceIndex === -1) {
      return { command: normalizeTelegramCommandName(withoutPrefix), args: '' };
    }
    return {
      command: normalizeTelegramCommandName(withoutPrefix.slice(0, whitespaceIndex)),
      args: withoutPrefix.slice(whitespaceIndex + 1).trim(),
    };
  }

  return null;
}

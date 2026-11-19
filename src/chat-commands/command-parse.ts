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
 * A leading path or bare slash leaves the message as ordinary input.
 */
export function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const part of trimmed.split(/\r?\n/)) {
    const line = part.trim();
    if (!line.startsWith('/')) continue;

    const match = /^\/([^/\s]+)(?:\s+([\s\S]*))?$/.exec(line);
    if (!match) return null;

    const command = normalizeTelegramCommandName(match[1]);
    return command ? { command, args: match[2]?.trim() ?? '' } : null;
  }

  return null;
}

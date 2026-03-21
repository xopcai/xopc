/**
 * Telegram sends `/cmd@BotUsername` in groups and from the command menu; registries
 * store commands as `cmd` only, so strip the @bot suffix before lookup.
 */
export function normalizeTelegramCommandName(command: string): string {
  const at = command.indexOf('@');
  if (at === -1) return command;
  return command.slice(0, at);
}

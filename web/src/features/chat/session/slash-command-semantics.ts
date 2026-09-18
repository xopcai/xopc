const RESET_COMMANDS = new Set(['new', 'reset', 'restart']);
const TASK_DESTRUCTIVE_COMMANDS = new Set([...RESET_COMMANDS, 'clear', 'archive']);

export function parseLeadingSlashCommand(content: string): { name: string; args: string } | null {
  const trimmed = content.trim();
  const match = /^\/([^\s@]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: match[2]?.trim() ?? '' };
}

export function isBareResetCommand(content: string): boolean {
  const parsed = parseLeadingSlashCommand(content);
  return Boolean(parsed && RESET_COMMANDS.has(parsed.name) && !parsed.args);
}

export function isTaskDestructiveCommand(content: string): boolean {
  const parsed = parseLeadingSlashCommand(content);
  return Boolean(parsed && TASK_DESTRUCTIVE_COMMANDS.has(parsed.name));
}

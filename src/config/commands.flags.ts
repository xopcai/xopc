export function isRestartEnabled(config?: { commands?: unknown }): boolean {
  const commands = config?.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(commands, 'restart')) {
    return true;
  }
  return (commands as { restart?: unknown }).restart !== false;
}

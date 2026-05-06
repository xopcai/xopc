import type { CommandEntry } from '@/features/chat/command-palette.types';

/** Same wire as global command palette when inserting a slash command into the composer. */
export function wireTextForSlashCommandEntry(c: CommandEntry): string {
  if (c.acceptsArgs) {
    return `/${c.name} `;
  }
  return `/${c.name}`;
}

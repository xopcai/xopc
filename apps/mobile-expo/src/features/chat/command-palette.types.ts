/** Types for the `/` command palette feature. */

export type PaletteItemKind = 'skill' | 'command';

export type CommandCategory = 'session' | 'model' | 'system' | 'tool' | 'extension';

export interface CommandEntry {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  category: CommandCategory;
  acceptsArgs: boolean;
  examples: string[];
}

export interface PaletteItem {
  kind: PaletteItemKind;
  id: string;
  name: string;
  description: string;
  category?: string;
  /** Skill source (builtin, workspace, …) */
  source?: string;
  aliases?: string[];
  acceptsArgs?: boolean;
}

export interface SlashRange {
  /** Start index of the `/` character in the text */
  start: number;
  /** End index (cursor position) */
  end: number;
  /** Text after `/` (the search query) */
  query: string;
}

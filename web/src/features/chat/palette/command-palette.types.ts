export type PaletteItemKind = 'skill' | 'command' | 'agent' | 'note';

export type CommandCategory = 'session' | 'model' | 'system' | 'tool' | 'extension';

export interface CommandEntry {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  category: CommandCategory;
  acceptsArgs: boolean;
  acceptsContext: boolean;
  examples: string[];
}

export type SkillAvailabilityStatus = 'available' | 'agent-denied' | 'disabled' | 'requirements-unmet' | 'model-invocation-disabled';

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
  acceptsContext?: boolean;
  /** Current agent skill availability; only set for `kind === 'skill'`. */
  availability?: {
    status: SkillAvailabilityStatus;
    reason?: string;
  };
  /** Agent avatar URL (only used by `kind === 'agent'` rows). */
  avatar?: string;
  /** Frozen Note identity used to create a message-level context reference. */
  noteRef?: {
    sourceId: string;
    expectedVersion: string;
  };
}

export interface SlashRange {
  start: number;
  end: number;
  query: string;
}

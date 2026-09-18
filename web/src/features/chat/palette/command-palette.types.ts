export type PaletteItemKind = 'skill' | 'command' | 'agent';

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

export type SkillAvailabilityStatus = 'available' | 'agent-denied' | 'disabled' | 'requirements-unmet' | 'model-invocation-disabled' | 'tool-gated';

interface PaletteItemBase {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
}

export interface SkillPaletteItem extends PaletteItemBase {
  kind: 'skill';
  /** Stable machine name used in /skill:name wire tokens. */
  canonicalName: string;
  category: 'skill';
  /** Skill source (builtin, workspace, …) */
  source?: string;
  /** Canonical and alternate-locale descriptions used only for search. */
  searchTerms?: string[];
  availability: {
    status: SkillAvailabilityStatus;
    reason?: string;
  };
}

export interface CommandPaletteItem extends PaletteItemBase {
  kind: 'command';
  category: CommandCategory;
  aliases: string[];
  acceptsArgs: boolean;
  acceptsContext: boolean;
  examples: string[];
}

export interface AgentPaletteItem extends PaletteItemBase {
  kind: 'agent';
  category: 'agent';
  agentId: string;
  avatar?: string;
}

export type PaletteItem = SkillPaletteItem | CommandPaletteItem | AgentPaletteItem;

export type PaletteSection = {
  [Kind in PaletteItemKind]: {
    kind: Kind;
    items: Array<Extract<PaletteItem, { kind: Kind }>>;
  };
}[PaletteItemKind];

export interface SlashRange {
  start: number;
  end: number;
  query: string;
}

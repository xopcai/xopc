/** Skills catalog — managed global skills (~/.xopcbot/skills). */

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: 'builtin' | 'workspace' | 'global' | 'extra';
  path: string;
  managed: boolean;
  /** User toggle (default true). */
  enabled: boolean;
  /** When true, skill is never shown to the model (SKILL.md). */
  disableModelInvocation: boolean;
}

export interface ManagedSkillDir {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface SkillsPayload {
  catalog: SkillCatalogEntry[];
  managed: ManagedSkillDir[];
}

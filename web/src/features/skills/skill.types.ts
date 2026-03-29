/** Skills catalog — managed global skills (~/.xopcbot/skills). */

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: 'builtin' | 'workspace' | 'global' | 'extra';
  path: string;
  managed: boolean;
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

export type SkillInstallTarget = 'workspace' | 'global';

export function normalizeSkillInstallTarget(value: unknown): SkillInstallTarget {
  return value === 'global' ? 'global' : 'workspace';
}

export function isSkillInstallTarget(value: unknown): value is SkillInstallTarget {
  return value === 'workspace' || value === 'global';
}

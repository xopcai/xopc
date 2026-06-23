export function configReloadSection(detail: unknown): unknown {
  if (!detail || typeof detail !== 'object' || !('section' in detail)) return undefined;
  return (detail as { section?: unknown }).section;
}

export function isSkillsOnlyConfigReload(detail: unknown): boolean {
  return configReloadSection(detail) === 'skills';
}

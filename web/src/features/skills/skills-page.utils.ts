import type { SkillCatalogEntry, SkillInstallSpecApi } from '@/features/skills/skill.types';

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function installSpecSummary(spec: SkillInstallSpecApi): string {
  const parts = [spec.kind];
  if (spec.label?.trim()) parts.push(spec.label.trim());
  if (spec.package?.trim()) parts.push(spec.package.trim());
  if (spec.formula?.trim()) parts.push(spec.formula.trim());
  if (spec.module?.trim()) parts.push(spec.module.trim());
  if (spec.url?.trim()) parts.push(spec.url.trim());
  return parts.join(' · ');
}

export function normalizeCatalogEntry(r: SkillCatalogEntry): SkillCatalogEntry {
  return {
    ...r,
    enabled: r.enabled ?? true,
    disableModelInvocation: r.disableModelInvocation ?? false,
  };
}

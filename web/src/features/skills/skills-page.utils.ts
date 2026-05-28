import type { SkillCatalogEntry, SkillInstallSpecApi } from '@/features/skills/skill.types';

const SKILLHUB_PUBLIC_ORIGIN = 'https://skillhub.cn';
const CLAWHUB_PUBLIC_ORIGIN = 'https://clawhub.ai';

/**
 * Public SkillHub web URL for a marketplace row `id` (canonical slug, e.g. `self-improving-agent` or `team--skill`).
 * Site shape: `https://skillhub.cn/skills/<slug>`.
 */
function skillHubPublicSkillPageUrl(canonicalSlug: string): string | null {
  const id = canonicalSlug.trim();
  if (!id) return null;
  return `${SKILLHUB_PUBLIC_ORIGIN}/skills/${encodeURIComponent(id)}`;
}

/**
 * Public ClawHub web URL for a marketplace skill slug.
 * Site shape: `https://clawhub.ai/<owner>/<slug>` — but since we don't have owner in list items,
 * we use the direct slug route which ClawHub resolves.
 */
function clawHubPublicSkillPageUrl(canonicalSlug: string): string | null {
  const id = canonicalSlug.trim();
  if (!id) return null;
  return `${CLAWHUB_PUBLIC_ORIGIN}/${encodeURIComponent(id)}`;
}

/** Get the public web URL for a skill row based on the active marketplace provider. */
export function marketplacePublicSkillUrl(
  provider: string | null,
  slug: string,
): string | null {
  if (provider === 'skillhub') return skillHubPublicSkillPageUrl(slug);
  if (provider === 'clawhub') return clawHubPublicSkillPageUrl(slug);
  return null;
}

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

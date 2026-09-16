import type { SkillInstallSpec, SkillLocalizations, SkillMetadata, SkillRequires } from './types.js';

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return undefined;
}

export function parseSkillLocalizations(
  frontmatter: Record<string, unknown>,
): { localizations?: SkillLocalizations; warning?: string } {
  const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
  const i18n = metadata?.i18n;
  if (i18n === undefined) return {};
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    return { warning: 'metadata.i18n must be a locale map' };
  }

  const localizations: SkillLocalizations = {};
  for (const locale of ['en', 'zh-CN'] as const) {
    const entry = (i18n as Record<string, unknown>)[locale];
    if (entry === undefined) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { warning: `metadata.i18n.${locale} must contain name and description` };
    }
    const localized = entry as Record<string, unknown>;
    const name = typeof localized.name === 'string' ? localized.name.trim() : '';
    const description = typeof localized.description === 'string' ? localized.description.trim() : '';
    if (!name || !description) {
      return { warning: `metadata.i18n.${locale} must contain non-empty name and description` };
    }
    localizations[locale] = { displayName: name, description };
  }

  return Object.keys(localizations).length > 0
    ? { localizations }
    : { warning: 'metadata.i18n has no supported locales' };
}

/**
 * Maps SKILL.md YAML frontmatter to {@link SkillMetadata} (Hermes / xopc shapes).
 */
export function parseSkillMetadata(frontmatter: Record<string, unknown>): SkillMetadata {
  const meta = frontmatter.metadata as Record<string, unknown> | undefined;
  const xopcMeta = meta?.xopc as Record<string, unknown> | undefined;

  const metadata: SkillMetadata = {
    name: (frontmatter.name as string) || '',
    description: (frontmatter.description as string) || '',
    emoji: (xopcMeta?.emoji as string) || (frontmatter.emoji as string) || undefined,
    homepage: (frontmatter.homepage as string) || undefined,
    os:
      (xopcMeta?.os as Array<'darwin' | 'linux' | 'win32'>) ||
      (frontmatter.os as Array<'darwin' | 'linux' | 'win32'>) ||
      undefined,
    requires:
      (xopcMeta?.requires as SkillRequires) || (frontmatter.requires as SkillRequires) || undefined,
    install:
      (xopcMeta?.install as SkillInstallSpec[]) || (frontmatter.install as SkillInstallSpec[]) || undefined,
  };

  if (xopcMeta) {
    metadata.xopc = {
      emoji: xopcMeta.emoji as string | undefined,
      requires: xopcMeta.requires as SkillRequires | undefined,
      install: xopcMeta.install as SkillInstallSpec[] | undefined,
      os: xopcMeta.os as Array<'darwin' | 'linux' | 'win32'> | undefined,
      activatesCapabilities: stringList(xopcMeta.activates_capabilities),
    };
  }

  return metadata;
}

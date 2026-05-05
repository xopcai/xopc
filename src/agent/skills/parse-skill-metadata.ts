import type { SkillInstallSpec, SkillMetadata, SkillRequires } from './types.js';

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
    };
  }

  return metadata;
}

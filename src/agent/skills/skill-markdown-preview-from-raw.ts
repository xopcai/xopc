import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { parseRequiredEnvVarNames } from './required-env-vars.js';
import { parseSkillMetadata } from './parse-skill-metadata.js';
import { parseSkillToolConditions } from './skill-tool-gating.js';
import type { SkillMarkdownPreviewPayload } from './types.js';

/**
 * SkillHub / hand-authored SKILL.md sometimes uses a single first line:
 * `name: slug description: long text...` without `---` YAML fences.
 */
function splitFlatNameDescriptionFirstLine(raw: string): { name: string; description: string; body: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const nl = trimmed.indexOf('\n');
  const firstLine = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
  const rest = nl === -1 ? '' : trimmed.slice(nl + 1).trim();
  const m = firstLine.match(/^name:\s+(\S+)\s+description:\s+(.+)$/i);
  if (!m) return null;
  return { name: m[1], description: m[2].trim(), body: rest };
}

/** Same payload shape as `getSkillMarkdownSource`, built from raw SKILL.md text only. */
export function buildSkillMarkdownPreviewFromRaw(
  raw: string,
  fallback: { name: string; description: string },
): SkillMarkdownPreviewPayload {
  const flat = splitFlatNameDescriptionFirstLine(raw);
  if (flat) {
    const fm = { name: flat.name, description: flat.description };
    const metadata = parseSkillMetadata(fm);
    return {
      name: flat.name,
      description: flat.description || fallback.description.trim(),
      bodyMarkdown: flat.body.trim(),
      disableModelInvocation: false,
      metadata,
      toolConditions: undefined,
      requiredEnvVarNames: undefined,
    };
  }

  const { frontmatter, content } = parseFrontmatter(raw.trim());
  const fm = frontmatter as Record<string, unknown>;
  const name = (typeof fm.name === 'string' && fm.name.trim()) || fallback.name;
  const descFromFm = typeof fm.description === 'string' ? fm.description.trim() : '';
  const description = descFromFm || fallback.description.trim() || '';
  const metadata = parseSkillMetadata(fm);
  if (!metadata.name.trim()) metadata.name = name;
  if (!metadata.description.trim()) metadata.description = description;

  const toolConditions = parseSkillToolConditions(fm);
  const requiredEnvVarNames = parseRequiredEnvVarNames(fm);

  return {
    name,
    description,
    bodyMarkdown: content.trim(),
    disableModelInvocation: fm['disable-model-invocation'] === true,
    metadata,
    toolConditions,
    requiredEnvVarNames: requiredEnvVarNames.length > 0 ? requiredEnvVarNames : undefined,
  };
}

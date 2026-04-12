/**
 * Parse Hermes-style `required_environment_variables` and legacy / xopc `requires.env` into a deduped name list.
 */

import { normalizeStringList } from './skill-tool-gating.js';

/** POSIX-style env var names we allow for passthrough registration. */
export const SKILL_ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidSkillEnvVarName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && SKILL_ENV_VAR_NAME_RE.test(t);
}

export function parseRequiredEnvVarNames(frontmatter: Record<string, unknown>): string[] {
  const out = new Set<string>();

  const fromHermes = frontmatter.required_environment_variables;
  if (Array.isArray(fromHermes)) {
    for (const item of fromHermes) {
      if (item && typeof item === 'object' && item !== null && 'name' in item) {
        const n = String((item as { name: unknown }).name).trim();
        if (n && isValidSkillEnvVarName(n)) out.add(n);
      }
    }
  }

  const prereq = frontmatter.prerequisites as Record<string, unknown> | undefined;
  if (prereq?.env_vars !== undefined) {
    for (const s of normalizeStringList(prereq.env_vars)) {
      if (isValidSkillEnvVarName(s)) out.add(s);
    }
  }

  const req = frontmatter.requires as { env?: unknown } | undefined;
  if (req?.env !== undefined) {
    for (const s of normalizeStringList(req.env)) {
      if (isValidSkillEnvVarName(s)) out.add(s);
    }
  }

  const meta = frontmatter.metadata as Record<string, unknown> | undefined;
  const xo = meta?.xopc as { requires?: { env?: unknown } } | undefined;
  if (xo?.requires?.env !== undefined) {
    for (const s of normalizeStringList(xo.requires.env)) {
      if (isValidSkillEnvVarName(s)) out.add(s);
    }
  }

  return [...out];
}

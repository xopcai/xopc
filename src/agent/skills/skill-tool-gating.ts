/**
 * Hermes-compatible skill visibility: requires_* / fallback_for_* against registered tool names and toolsets.
 */

import type { Skill, SkillToolConditions } from './types.js';

/** Maps logical toolset ids to xopc {@link AgentTool} names (all must be present for the toolset to count as available). */
export const SKILL_TOOLSET_TOOLS: Record<string, readonly string[]> = {
  web: ['web_search', 'web_fetch', 'web_extract'],
  browser: [
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_scroll',
    'browser_screenshot',
  ],
  terminal: ['shell'],
  vision: ['image'],
  image_gen: ['image_generate'],
  skills: ['skills_list', 'skill_view', 'skill_manage'],
};

function emptyConditions(c: SkillToolConditions | undefined): boolean {
  if (!c) return true;
  return (
    c.requiresTools.length === 0 &&
    c.requiresToolsets.length === 0 &&
    c.fallbackForTools.length === 0 &&
    c.fallbackForToolsets.length === 0
  );
}

/** Toolsets that are fully satisfied by the given registered tool names. */
export function toolsetsSatisfiedByTools(registeredTools: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [name, tools] of Object.entries(SKILL_TOOLSET_TOOLS)) {
    if (tools.length > 0 && tools.every((t) => registeredTools.has(t))) {
      out.add(name);
    }
  }
  return out;
}

/**
 * Hermes semantics: hide if any fallback tool/toolset is present; hide if any required tool/toolset is missing.
 */
export function skillVisibleForRegisteredTools(skill: Skill, registeredTools: Set<string>): boolean {
  const c = skill.toolConditions;
  if (emptyConditions(c)) {
    return true;
  }

  const satisfiedToolsets = toolsetsSatisfiedByTools(registeredTools);

  for (const t of c.fallbackForTools) {
    if (registeredTools.has(t)) {
      return false;
    }
  }
  for (const ts of c.fallbackForToolsets) {
    if (satisfiedToolsets.has(ts)) {
      return false;
    }
  }
  for (const ts of c.requiresToolsets) {
    if (!satisfiedToolsets.has(ts)) {
      return false;
    }
  }
  for (const t of c.requiresTools) {
    if (!registeredTools.has(t)) {
      return false;
    }
  }
  return true;
}

export function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? [t] : [];
  }
  return [];
}

/**
 * Read `metadata.hermes` and `metadata.xopc` for tool gating keys (YAML snake_case).
 * Later sources extend earlier (merge unique order).
 */
export function parseSkillToolConditions(frontmatter: Record<string, unknown>): SkillToolConditions | undefined {
  const meta = frontmatter.metadata as Record<string, unknown> | undefined;
  const hermes = meta?.hermes as Record<string, unknown> | undefined;
  const xopc = meta?.xopc as Record<string, unknown> | undefined;

  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];

  let requiresTools = normalizeStringList(hermes?.requires_tools);
  let requiresToolsets = normalizeStringList(hermes?.requires_toolsets);
  let fallbackForTools = normalizeStringList(hermes?.fallback_for_tools);
  let fallbackForToolsets = normalizeStringList(hermes?.fallback_for_toolsets);

  requiresTools = merge(requiresTools, normalizeStringList(xopc?.requires_tools));
  requiresToolsets = merge(requiresToolsets, normalizeStringList(xopc?.requires_toolsets));
  fallbackForTools = merge(fallbackForTools, normalizeStringList(xopc?.fallback_for_tools));
  fallbackForToolsets = merge(fallbackForToolsets, normalizeStringList(xopc?.fallback_for_toolsets));

  const out: SkillToolConditions = {
    requiresTools,
    requiresToolsets,
    fallbackForTools,
    fallbackForToolsets,
  };

  return emptyConditions(out) ? undefined : out;
}
